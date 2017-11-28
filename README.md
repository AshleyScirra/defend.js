# Statically-typed classes in JavaScript with defend.js
JavaScript is dynamically typed. This makes it flexible, but can lead to bugs from as little as a typo, and can be difficult to optimise well. However this library, based on ES6 Proxy objects, allows you to create a class that is effectively statically typed. This ensures it is only ever used with a fixed set of properties of a fixed type, catching errors caused by typos, inconsistent usage, or accidentally changing types (e.g. switching a string to a number).

While the checks have a performance overhead, they can also easily be turned off, which then ensures maximum performance in the JS engine since all types and object shapes are predictable.

This library has also been proven in production, helping catch bugs in [Construct 3](https://editor.construct.net), a PWA with over 250,000 lines of JavaScript code.

# How to use
You must opt-in classes to be defended by deriving from `DefendedBase`. (This also allows you to gradually roll-out checks in an existing codebase, one class at a time.) Then the class must be created with a library-provided `New` function. This function effectively replaces the normal JS `new` operator. (After much research, this was the least bad option.) The `New` function can also be used for any kind of class, not just defended ones.

## Before
```js
class Example {
	constructor(param)
	{
		this._param = param;
	}
}

const o = new Example(123);

// Logs "undefined"
console.log(o._missing);

// Silently changes number to string
o._param = "foo";
```

## After
```js
import { DefendedBase, New } from "./defend.js"

class Example extends DefendedBase {
	constructor(param)
	{
		super();

		this._param = param;
	}
}

// 'o' is now defended
const o = New(Example, 123);

// "Accessed missing property '_missing' from defended object 'Example'"
console.log(o._missing);

// "Set 'number' property '_param' to type 'string' on defended object 'Example'"
o._param = "foo";
```

## More code examples
See `example.js` for more, which comprehensively covers the feature list below with working code examples.

# Features
- Prevent accessing missing properties
- Prevent setting new properties after constructor
- Prevent changing property type, e.g. from number to string
- Prevent removing properties with `delete`
- Prevent any access after a `Release(o)` call, catching dangling-reference type bugs
- Prevent `defineProperty` (since it would provide a loophole to these restrictions)
- Verify defended objects are created with `New()` and not still using the JS `new` operator
- Verify class always creates the same set of properties, i.e. it doesn't conditionally set different properties in the constructor, which changes the shape of the object and reduces performance
- Easily apply to individual classes only; performance-critical classes can be left out, even when checks enabled
- Easily completely disable checks for full performance, e.g. for release builds. Alternatively there is a mode to fall back to simply using `Object.seal()` which provides a basic check against setting new properties without the full Proxy overhead.
- Verified in production, to work out quirks like passing `this` outside the constructor, not logging errors when accessing `then` when promises check for "thennable" objects, etc.

# API
The module exports the following:
- `SetMode(mode)`: pass `"defend"` for full checks, `"seal"` for `Object.seal()` only, or `"off"` to completely disable checks (e.g. for release builds).
- `SetWarningCallback(f)`: set a custom callback function for when a problem is detected. The callback takes a string of the message. The default is to pass to `console.warn()`, but you might want to log it somewhere else, throw an exception, etc.
- `DefendedBase`: base class for any class to have defend checks applied.
- `New(Type, ...args)`: wrapper for normal JS `new`. Required for defend checks implementation. Can be used with any class, even if they aren't defended.
- `Release(o)`: release a defended object. Any subsequent access to that object will log an error.
- `WasReleased(o)`: return a boolean indicating if the object was already released, without logging any errors.

# Further work
If JavaScript provided a hook to get a callback whenever `new` is used, this library could be adapted to avoid the need for a custom `New()` function.