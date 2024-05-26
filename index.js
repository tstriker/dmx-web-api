class Backend {
    // abstract away the different ways to talk DMX
    label = "";
    init() {}
    onUpdate() {}
    sendSignal() {}
    close() {}
}

export class SerialBackend extends Backend {
    // serial uses the web serial API directly
    // https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API
    constructor(port, writer) {
        super();
        this.port = port;
        this.writer = writer;
    }
}

export class BufferedBackend extends SerialBackend {
    // a buffered interface that is very specific about its init message
    static type = "buffered";
    static label = "Buffered (pro version)";

    constructor(port, writer) {
        super(port, writer);
        this.same = 0;
    }

    onUpdate() {
        this.same = 0;
    }

    async sendSignal(data) {
        if (this.same > 3 || !this.writer) {
            return;
        }
        // at times the device cache drops a frame and we don't end up in the final desired state
        // to mitigated that instead of using a 'changed' boolean we use a sameness incrementor
        // this means that we'll send 4 frames of the final state when things calm down
        this.same += 1;
        await this.writer.ready;
        await this.writer.write(new Uint8Array([0x7e, 0x06, 0x01, 0x02, 0x00, ...data, 0xe7]));
    }
}

export class DirectBackend extends SerialBackend {
    // just a dumb forwarder. one caveat is that you have to keep the tab visible or
    // otherwise chrome will spin down the timers and the lights will start flickering
    static type = "direct";
    static label = "Direct (open version)";

    async sendSignal(data) {
        if (!this.port || !this.writer) {
            // we are not ready yet
            return;
        }

        await this.writer.ready;
        await this.port.setSignals({break: true, requestToSend: false});
        await this.port.setSignals({break: false, requestToSend: false});
        await this.writer.write(new Uint8Array([0x00, ...data]));
    }
}

export class DMX {
    static backends = [BufferedBackend, DirectBackend];

    constructor(connectorIdx, manualTicks) {
        this.port = null;
        this.data = new Uint8Array(512);
        this.writer = null;
        this.onTick = null;
        this._sendTimeout = null;

        // which connector are we connecting to in case if there are several
        // there is no meaningful way to tell them apart, so we just grab first/second/etc and the person running lights
        // can swap cables if the endpoints have suddenly flipped
        this.connectorIdx = connectorIdx || 0;
        this.manualTicks = manualTicks || false; // in case you'll be calling the sendLoop yourself

        this.backendClass = null;
        this.backend = null;

        this.retry = false;
    }

    async canAccess() {
        if (!navigator.serial) {
            // navigator serial is only present in chrome - do not explode in firefox etc
            return false;
        }

        let ports = await navigator.serial.getPorts();
        return ports.length > 0;
    }

    async connect(onTick, backendClass = null, askPermission = false) {
        // DMX class has an internal clock that makes sure we don't write to the DMX widget too often
        // to reduce off-sync between different clocks, pass in an onTick function that will be called when
        // the widget is ready for more data (on average at 40fps or so)
        // backendClass should be one of the backends. set askPemission to true when connection is initiated by the user
        if (!navigator.serial) {
            // navigator serial is only present in chrome - do not explode in firefox etc
            if (askPermission) {
                console.warn("Serial API does not seem to be supported on this browser, can't enable DMX control!");
            }
            return false;
        }

        if (!this.writer) {
            let ports = await navigator.serial.getPorts({filters: [{usbVendorId: 0x0403}]});

            if ((!ports.length || ports.length <= this.connectorIdx) && askPermission) {
                await navigator.serial.requestPort({filters: [{usbVendorId: 0x0403}]});
                ports = await navigator.serial.getPorts({filters: [{usbVendorId: 0x0403}]});
            }

            if (ports.length) {
                let port = ports[this.connectorIdx];
                try {
                    await port.open({
                        baudRate: 250 * 1000,
                        dataBits: 8,
                        stopBits: 2,
                        parity: "none",
                    });
                    this.port = port;
                    this.writer = await this.port.writable.getWriter();
                } catch (e) {
                    if (e.name != "InvalidStateError") {
                        // invalid state error is when port is already open, which is fine by us.
                        // Anything else we throw
                        console.error(e);
                    }
                }
            }
        }

        this.onTick = onTick;
        this.backendClass = backendClass;
        if (this.backendClass) {
            this.backend = new this.backendClass(this.port, this.writer);
        }

        if (!this.manualTicks) {
            this._sendLoop();
        }
        return this.writer != null;
    }

    async tick() {
        if (this.writer && this.backend) {
            // if we are ready and we know who to send signals to
            await this.backend.sendSignal(this.data).catch(error => {
                // Note: the failure message will appear in the logs a few times as we are not doing blocking requests
                // here and so we might try issuing a bunch of sendSignals before we catch up with the fact that
                // the dongle is gone
                console.error(error);
                console.error("Failed to send signal to DMX controller, will attempt to reconnect");

                this.writer = null;
                this.retry = true;
            });
        }

        if (!this.writer && this.retry) {
            // if we have lost writer and are not already in the middle of trying to connect
            // we don't ask for permission as we assume we had it before
            this.retry = false;
            await this.connect(this.onTick, this.backendClass);

            if (!this.writer) {
                console.info("Reconnect failed. Retry in 300ms");
                setTimeout(() => (this.retry = true), 300);
            }
        }
    }

    async _sendLoop() {
        clearInterval(this._sendTimeout);
        if (this.onTick) {
            this.onTick();
        }

        await this.tick();

        // Note: DMX protocol operates at max 44fps (but 40fps is safer as enttec pushes for that), so best we can
        // hope for is a frame every 25ms https://en.wikipedia.org/wiki/DMX512
        this._sendTimeout = setTimeout(() => this._sendLoop(), 25);
    }

    async update(data) {
        Object.entries(data).forEach(([ch, val]) => {
            let [chInt, valInt] = [parseInt(ch), parseInt(val)];
            if (chInt < 1 || chInt > 512) {
                console.error(`Channel should be between 1 and 512. Received ${ch}`);
            } else if (valInt < 0 || valInt > 255) {
                console.error(`Value should be between 0 and 255. Received channel: ${ch}, value: ${val}`);
            } else {
                this.data[chInt - 1] = valInt;
            }
        });
        if (this.backend) {
            this.backend.onUpdate(data);
        }
    }

    async disconnect() {
        if (this.writer) {
            let writer = this.writer;
            this.writer = null;
            await writer.close();
            await this.port.close();
        }
    }

    async close() {
        this.disconnect();
        clearInterval(this._sendTimeout);
    }
}
