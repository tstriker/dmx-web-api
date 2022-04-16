import {Backend} from "dmx-web-api";
export class EnttecOpenNode extends Backend {
    // a node server that talks to the enttec open usb - this doesn't require
    // running the loop in the browser and so don't have to worry about tabs
    // this does require running the node mini-server on localhost though
    label = "Enttec Open DMX USB via a node server listening to sockets";
    constructor() {
        super();
        this.dmxSocket = null;
    }

    async init() {
        this.dmxSocket = io("http://localhost:8090", {
            withCredentials: true,
        });

        let connected = new Promise(resolve => {
            this.dmxSocket.on("connect", () => {
                resolve();
            });
        });
        await connected;
    }

    onUpdate(data) {
        this.dmxSocket.emit("update", {data});
    }
}