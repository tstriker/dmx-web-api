export class DMX {
    constructor(backend) {
        this.port = null;
        this.data = new Uint8Array(512);
        this.writer = null;
        this.ready = false;
        this.serial = true;
        this.backends = {eurolite: Eurolite, "enttec-open-dmx": EnttecOpen};
        this.backendClass = backend || null;
        this.onTick = null;
        this._sendInterval = null;
    }

    async canAccess() {
        if (this.serial && navigator.serial) {
            let ports = await navigator.serial.getPorts();
            return ports.length > 0;
        }
    }

    async init(backendName = null, onTick = null) {
        this.onTick = onTick;
        if (this.ready) {
            return;
        }

        if (backendName) {
            this.backendClass = this.backends[backendName];
        }

        this.backend = new this.backendClass();
        await this.backend.init();
        this.ready = true;

        this._sendLoop();
    }

    async _sendLoop() {
        clearInterval(this._sendInterval);
        if (this.ready) {
            if (this.onTick) {
                this.onTick();
            }

            this.backend.sendSignal(this.data).catch(error => {
                console.error(error);
                console.error("Failed to send signal to DMX controller, will attempt to reconnect");
                this.ready = false;
            });
            // NOTE: DMX protocol operates at max 44fps, so best we can hope for is a frame every 22ms
            // https://en.wikipedia.org/wiki/DMX512
            this._sendInterval = setTimeout(() => this._sendLoop(), 23);
        } else {
            try {
                await this.init();
            } catch (error) {
                console.error("Reconnect failed. Retry in 300ms");
                this._sendInterval = setTimeout(() => this._sendLoop(), 300);
            }
        }
    }

    async update(data) {
        if (!this.backend) {
            console.log("Can't run update before init() has been called!");
            return;
        }

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
        this.backend.onUpdate(data);
    }

    async close() {
        clearInterval(this._sendInterval);
        if (this.backend) {
            this.backend.close();
        }
        this.ready = false;
    }
}

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
    constructor() {
        super();
        this.writer = null;
        this.port = null;
    }

    static requestPermission() {
        return navigator.serial.requestPort({filters: [{usbVendorId: 0x0403}]});
    }

    async init() {
        let ports = await navigator.serial.getPorts();
        if (!ports.length) {
            await SerialBackend.requestPermission();
            this.init();
            return;
        }

        // just grab the first for now that matches our specs
        this.port = ports[0];

        try {
            await this.port.open({
                baudRate: 250 * 1000,
                dataBits: 8,
                stopBits: 2,
                parity: "none",
            });
        } catch (e) {
            if (e.name != "InvalidStateError") {
                // invalid state error is when port is already open, which is fine by us.
                // Anything else we throw
                throw e;
            }
        }
        this.writer = await this.port.writable.getWriter();
    }

    async close() {
        await this.writer.releaseLock();
        await this.port.close();
    }
}

export class Eurolite extends SerialBackend {
    // a buffered interface that is very specific about its init message
    label = "Eurolite DMX512 Pro Mk2";
    constructor() {
        super();
        this.same = 0;
    }
    onUpdate() {
        this.same = 0;
    }

    async sendSignal(data) {
        if (this.same > 3 || !this.writer) {
            return;
        }
        // every now and then the cache loses a frame and we end up with not the final state
        // to mitigated that instead of using a 'changed' boolean we use a sameness incrementor
        // this means that we'll send 4 frames of the final state when things calm down
        this.same += 1;
        await this.writer.ready;
        await this.writer.write(new Uint8Array([0x7e, 0x06, 0x01, 0x02, 0x00, ...data, 0xe7]));
    }
}

export class EnttecOpen extends SerialBackend {
    // just a dumb forwarder. one caveat is that you have to keep the tab visible or
    // otherwise chrome will spin down the timers and the lights will start flickering
    label = "Enttec Open DMX USB in browser. Keep the tab visible!";
    async sendSignal(data) {
        if (!this.port || !this.writer) {
            // we are not ready yet
            return;
        }

        await this.port.setSignals({break: true, requestToSend: false});
        await this.port.setSignals({break: false, requestToSend: false});
        await this.writer.write(new Uint8Array([0x00, ...data]));
    }
}
