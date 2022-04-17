export class DMX {
    constructor(backend) {
        this.port = null;
        this.data = new Uint8Array(512);
        this.writer = null;
        this.ready = false;
        this.backendClass = backend;

        this._sendInterval = null;
    }

    async init() {
        if (this.ready) {
            return;
        }

        this.backend = new this.backendClass();
        await this.backend.init();
        this.ready = true;

        // seems like every 50ms or so is what the dongles can support before they become overwhelmed
        this._sendInterval = setInterval(() => this._sendLoop(), 50);
    }

    async _sendLoop() {
        this.backend.sendSignal(this.data);
    }

    async update(data) {
        if (!this.backend) {
            console.log("Can't run update before init() has been called!");
            return;
        }

        Object.entries(data).forEach(([ch, val]) => {
            this.data[parseInt(ch) - 1] = parseInt(val);
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

export class Backend {
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
            this.requestPermission();
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

    async requestPermission() {
        await navigator.serial.requestPort({filters: [{usbVendorId: 0x0403}]});
        this.init();
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
        this.port.setSignals({break: true, requestToSend: false});
        this.port.setSignals({break: false, requestToSend: false});
        this.writer.write(new Uint8Array([0x00, ...data]));
    }
}
