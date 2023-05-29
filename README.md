# DMX Control directly from your browser

This super tiny lib knows how to talk DMX through browser's [Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API).
Currently [Enttec's Open DMX](https://www.enttec.com/product/lighting-communication-protocols/dmx512/open-dmx-usb/) and
[Eurolite's USB-DMX512 PRO Interface MK2](https://www.thomann.de/gb/eurolite_usb_dmx512_pro_interface_mk2.htm) are supported.
Patches for other devices are most welcome!

# Note: the API is supported by Chrome only!

Unfortunately other browsers do not yet support neither the Serial nor USB API's, generally claiming security reasons.

# Install

`npm install dmx-web-api`

# Demo

```javascript
import {DMX, Eurolite} from "dmx-web-api";

let dmxDevice = new DMX();

function initDMX() {
    // call this func on a user action, like a click or tap as
    // the init will ask for permission to access
    // right now the two supported dongles are Eurolite Mk2, and Enttect Open USB
    this.dmxDevice.connect(Eurolite);
}

function updateDMX(data) {
    // data can be either an object of form {channel: value}, or a full 512 element array.
    // set first channel to 255 (say, because you have a simple RGB light listening on address 1)
    this.dmxDevice.update({1: 255, 2: 0, 3: 0});
}
```

# Note on Enttec's Open DMX

Make sure the tab you are sending the signal from is visible at all times, as chrome will spin down the internal
timers when the tab is not visible, and you will get flickering lights.
A simple way around that is to run a tiny node server and talk sockets to it. Code for doing that is in the [github repo](https://github.com/tstriker/dmx-web-api/tree/main/node-server).
