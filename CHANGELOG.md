# 0.1.8

* Put setTimeout back as it was inexplicably driving eurolite's dongle nuts
  on non-linux systems or somesuch (still figuring it out proper)

# 0.1.7

* Fix a requestPermission mixup (it is supposed to be a static method)


# 0.1.6

* Lighten up the send loop by relying on setInterval rather than setTimeout
* Fix init explodes when connecting happens on the fly
