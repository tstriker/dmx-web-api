export class DMX {
    constructor(backend) {
        this.port = null;
        this.data = new Uint8Array(512);
        this.writer = null;
        this.ready = false;
        this.serial = true;
        this.backends = {eurolite: Eurolite, "enttec-open-dmx": EnttecOpen};
        this.backendClass = backend || null;
        this._sendInterval = null;
        this.prev = 0;
    }

    async canAccess() {
        if (this.serial) {
            let ports = await navigator.serial.getPorts();
            return ports.length > 0;
        }
    }

    async init(backendName = null) {
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
        if (this.ready) {
            try {
                await this.backend.sendSignal(this.data);
            } catch (error) {
                console.error("Failed to send signal to DMX controller, will attempt to reconnect");
                this.ready = false;
            }
            // seems like every 50ms or so is what the dongles can support before they become overwhelmed
            this._sendInterval = setTimeout(() => this._sendLoop(), 50);
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

    async init() {
        let ports = await navigator.serial.getPorts();
        if (!ports.length) {
            await this.requestPermission();
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

    static async requestPermission() {
        await navigator.serial.requestPort({filters: [{usbVendorId: 0x0403}]});
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
        this.changed = true;
    }
    onUpdate() {
        this.changed = true;
    }

    async sendSignal(data) {
        if (!this.changed) {
            return;
        }
        this.changed = false;
        await this.writer.ready;
        await this.writer.write(new Uint8Array([0x7e, 0x06, 0x01, 0x02, 0x00, ...data, 0xe7]));
    }
}

export class EnttecOpen extends SerialBackend {
    // just a dumb forwarder. one caveat is that you have to keep the tab visible or
    // otherwise chrome will spin down the timers and the lights will start flickering
    label = "Enttec Open DMX USB in browser. Keep the tab visible!";
    async sendSignal(data) {
        await this.port.setSignals({break: true, requestToSend: false});
        await this.port.setSignals({break: false, requestToSend: false});
        await this.writer.write(new Uint8Array([0x00, ...data]));
    }
}
