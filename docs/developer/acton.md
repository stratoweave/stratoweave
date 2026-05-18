# Acton

StratoWeave is written in the [Acton Programming Language](https://acton.now).
The [Acton guide](https://acton.guide) provides comprehensive documentation on
the language's syntax, features, and best practices.
Try [Ask Acton](https://ask.acton.guide) to get quick answers to specific questions.

As a Python developer, you will find a syntax that is instantly familiar, but
there's also a few key differences to be aware of. The most obvious one is
that Acton is a compiled and statically typed language. Yet, thanks to its
powerful type inference, you can mostly write code without explicit type
annotations and still get the benefits of static typing.

## Optional types
In Acton's type system, a type can be either optional or non-optional.
An optional type can be `None` or a value of the specified type,
while a non-optional type must always have a value. In your StratoWeave
transforms, the data nodes will be optional or non-optional based on how they
are defined in the YANG model.

Consider this dummy YANG snippet.
```yang title="spec/yang/foo/toaster.yang"
list toaster {
  key name;
  sw:transform dummy.foo.Toaster;

  leaf name {
    type string;
  }
  leaf model {
    type string;
  }
  leaf capacity {
    type uint32;
    mandatory true;
  }
  leaf power {
    type uint32;
    default 11;
  }
}
```
The following properties will be **non-optional** in the transform input:

- `name` because it's a *key leaf*
- `capacity` because it's a *mandatory leaf*
- `power` because it has a *default value*

The `model` property will be **optional**, however, which means that we must ensure
it is not `None` before we can do string operations on it. Assign its value
to a local variable and check for `is not None` before using it.

```acton title="src/dummy/foo.act"
class Toaster(base.Toaster):
    def transform(self, i):
        print(i.name.upper())
        print(i.capacity + 1)
        print(i.power * 2)

        model = i.model # optional type, must check for None before using
        if model is not None:
            print(model.upper())
```

Failure to check for `#!acton is not None` on an optional type before using it will
result in a compile-time error. While seemingly inconvenient at first, this
strong typing helps catch potential bugs early and ensures that your
transform logic is robust against missing or incomplete input data.

If you find that you have to write a lot of `#!acton is not None` checks that
do not seem to add value, it may be a sign that the YANG model should be
updated to make that node mandatory or give it a default value.
Particularly for lower-layer transforms, it's often better to have a more
strictly defined input schema to avoid having to write defensive code in the
transform method.