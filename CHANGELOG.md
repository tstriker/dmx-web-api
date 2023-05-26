# 0.1.9

* Sort out timing so that we come back after 23ms and not wait for the
  operation to finish the 23ms correspond to the 44Hz that the DMX512 is
  capable of (effectively 44 fps)
* Eurolite - when new data stops coming in, we still send another 4 frames to
  make sure the dongle hasn't stuck on an unfinished state (seems to happen at
  times)


# 0.1.8

* Put setTimeout back as it was inexplicably driving eurolite's dongle nuts
  on non-linux systems or somesuch (still figuring it out proper)

# 0.1.7

* Fix a requestPermission mixup (it is supposed to be a static method)


# 0.1.6

* Lighten up the send loop by relying on setInterval rather than setTimeout
* Fix init explodes when connecting happens on the fly
