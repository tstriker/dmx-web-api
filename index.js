class Backend {
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
        // PERFORMANCE: Pre-allocate the buffer once to avoid creating new arrays on every frame.
        // The buffer includes the DMXking protocol header and footer.
        // [header(5), data(512), footer(1)]
        this.buffer = new Uint8Array(518);
        this.buffer[0] = 0x7e; // DMX Start Code
        this.buffer[1] = 0x06; // DMX Label
        this.buffer[2] = 0x01; // Data length LSB
        this.buffer[3] = 0x02; // Data length MSB (513)
        this.buffer[4] = 0x00; // DMX Start Code for data
        this.buffer[517] = 0xe7; // DMX End Code
    }

    onUpdate() {
        this.same = 0;
    }

    async sendSignal(data) {
        if (this.same > 3 || !this.writer) {
            return;
        }

        // This counter ensures the final state is sent multiple times to mitigate dropped frames.
        this.same += 1;

        // The DMX channel data is placed after the 5-byte header.
        this.buffer.set(data, 5);

        await this.writer.ready;
        await this.writer.write(this.buffer);
    }
}

export class DirectBackend extends SerialBackend {
    // just a dumb forwarder. one caveat is that you have to keep the tab visible or
    // otherwise chrome will spin down the timers and the lights will start flickering
    static type = "direct";
    static label = "Direct (open version)";

    constructor(port, writer) {
        super(port, writer);
        // The buffer includes the DMX start code (0x00).
        // [start_code(1), data(512)]
        this.buffer = new Uint8Array(513);
        this.buffer[0] = 0x00; // DMX Start Code for data
    }

    async sendSignal(data) {
        if (!this.port || !this.writer) {
            return; // Not ready yet.
        }

        // PERFORMANCE: Copy the DMX data into our pre-allocated buffer.
        // The data is placed after the 1-byte start code.
        this.buffer.set(data, 1);

        await this.writer.ready;
        // The 'break' signal is part of the DMX protocol to signify the start of a new frame.
        await this.port.setSignals({break: true, requestToSend: false});
        await this.port.setSignals({break: false, requestToSend: false});
        await this.writer.write(this.buffer);
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
        this.connected = false;
        this.retry = false;
        this.id = Math.round(Math.random() * 100000);
    }

    async canAccess() {
        if (!navigator.serial) {
            // navigator serial is only present in chrome - do not explode in firefox etc
            return false;
        }
        const ports = await navigator.serial.getPorts();
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
                console.warn("Web Serial API not supported. Cannot enable DMX control.");
            }
            return false;
        }

        if (!this.writer) {
            const deviceCriteria = {filters: [{usbVendorId: 0x0403}]};
            let ports = await navigator.serial.getPorts(deviceCriteria);

            if ((!ports.length || ports.length <= this.connectorIdx) && askPermission) {
                await navigator.serial.requestPort(deviceCriteria);
                ports = await navigator.serial.getPorts(deviceCriteria);
            }

            if (ports[this.connectorIdx]) {
                const port = ports[this.connectorIdx];
                try {
                    await port.open({
                        baudRate: 250000,
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
                console.info("Reconnect failed. Retrying in 300ms.");
                setTimeout(() => (this.retry = true), 300);
            }
        }
    }

    async _sendLoop() {
        clearTimeout(this._sendTimeout);

        let connected = this.port?.connected;
        if (this.backend && connected != this.connected) {
            // trigger backend reset when connection changes
            // this affects buffered backend and fixes reconnect
            this.backend.onUpdate();
        }
        this.connected = connected;

        let doNotSend = false;
        if (this.onTick) {
            doNotSend = this.onTick(connected);
        }
        if (doNotSend !== true) {
            // onTick callback can decide that it's not ready just yet
            await this.tick();
        }

        // Note: DMX protocol operates at max 44fps (but 40fps is safer as enttec pushes for that), so best we can
        // hope for is a frame every 25ms https://en.wikipedia.org/wiki/DMX512
        this._sendTimeout = setTimeout(() => this._sendLoop(), 25);
    }

    async update(data) {
        if (data instanceof Uint8Array) {
            // the passed in array is 1-indexed, so that we can do channels[1] = "red", instead of having to account
            // for 0-indexing. as a result we need to grab from the 1st position
            this.data.set(data.subarray(1, 513));
        } else {
            for (const ch in data) {
                const val = data[ch];
                const chInt = parseInt(ch, 10);
                const valInt = parseInt(val, 10);

                if (chInt < 1 || chInt > 512) {
                    console.error(`Channel should be between 1 and 512. Received ${ch}`);
                } else if (valInt < 0 || valInt > 255) {
                    console.error(`Value should be between 0 and 255. Received channel: ${ch}, value: ${val}`);
                } else {
                    this.data[chInt - 1] = valInt;
                }
            }
        }

        if (this.backend) {
            this.backend.onUpdate(data);
        }
    }

    async disconnect() {
        if (this.writer) {
            const writer = this.writer;
            this.writer = null;
            await writer.close();
            await this.port.close();
        }
    }

    async close() {
        clearTimeout(this._sendTimeout);
        await this.disconnect();
    }
}
