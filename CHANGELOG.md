# 0.2.3

-   Failed miserably with the sniffing of model because serial numbers for
    these dongle's aren't specific to the repackager but rather they
    are just unique; so no way for now to tell an enttec apart from a eurolite.
    oh well. back to feeding in a model in constructor

# 0.2.2

-   Still battling timing woes; The dongles do not want to adhere to exact
    40fps rather have to do a blocking send and then give a bit of time for
    the thing to breathe before sending the next package

# 0.2.0

-   Instead of requesting that a backend class is passed in, we ask user to grant
    us permission to the USB device and figure out the backend from the serial
    number. Cons: asking permission twice. Pros: don't have to think about
    backend model;
-   The change breaks API - now you just need to call `.connect()` without specifying
    the backend

# 0.1.9

-   Sort out timing so that we come back after 23ms and not wait for the
    operation to finish the 23ms correspond to the 44Hz that the DMX512 is
    capable of (effectively 44 fps)
-   Eurolite - when new data stops coming in, we still send another 4 frames to
    make sure the dongle hasn't stuck on an unfinished state (seems to happen at
    times)

# 0.1.8

-   Put setTimeout back as it was inexplicably driving eurolite's dongle nuts
    on non-linux systems or somesuch (still figuring it out proper)

# 0.1.7

-   Fix a requestPermission mixup (it is supposed to be a static method)

# 0.1.6

-   Lighten up the send loop by relying on setInterval rather than setTimeout
-   Fix init explodes when connecting happens on the fly
