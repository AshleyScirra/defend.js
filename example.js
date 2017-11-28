import { DefendedBase, New, Release } from "./defend.js"

class Test extends DefendedBase {
	constructor()
	{
		super();
		
		this._str = "foo";
	}
	
	SetString(s)
	{
		this._str = s;
	}
	
	GetString()
	{
		return this._str;
	}
}

const o = New(Test);

// Normal accesses should be OK...
o.SetString("bar");
console.log("GetString(): " + o.GetString());
console.log("-- should be no errors before here --");

// Getting non-existent property
// Logs: "Accessed missing property '_invalidProperty' from defended object 'Test', returning undefined"
console.log("Non-existent property: " + o._invalidProperty);

// Setting new property not in constructor
// Logs: "Set non-existent property '_newProperty' to '1' on defended object 'Test'"
console.log("Setting o._newProperty...");
o._newProperty = 1;

// Changing a property to an unrelated type
// Logs: "Set 'string' property '_str' to type 'number' on defended object 'Test'"
console.log("Calling SetString() with number...");
o.SetString(123);

// Try deleting a property
// Throws: "ReferenceError: Cannot delete property '_str' from defended object 'Test'"
console.log("Trying to delete a property...");
try {
	delete o._str;
}
catch (err) {
	console.warn("Exception deleting property: ", err);
}

// Try using defineProperty
// Throws: "ReferenceError: Cannot define property 'baz' on defended object 'Test'"
console.log("Trying to defineProperty...");
try {
	Object.defineProperty(o, "baz", { value: 0 });
}
catch (err) {
	console.warn("Exception defining property: ", err);
}

// Now release the object
console.log("Releasing object...");
Release(o);

// Now accessing valid methods on it will log warnings, e.g. calling GetString().
// Note this logs two errors, one for the GetString access, and the other for the _str access.
// The log messages include both the call stack at the point the object was released, and the 
// call stack at the point the released object was subsequently accessed.
console.log("GetString() after Release(): " + o.GetString());

// Create a new class that creates inconsistent property sets.
class InconsistentProperties extends DefendedBase {
	constructor(flag)
	{
		super();
		
		this._commonProperty = 1;
		
		// Changes shape of object depending on 'flag'!
		// This can deoptimise this class in JS engines.
		if (flag)
			this._withFlag = 2;
		else
			this._withoutFlag = 3;
	}
}

// Create both kinds of class.
// Logs: "'InconsistentProperties' constructor creates inconsistent properties: _withFlag, _withoutFlag"
console.log("Creating both kinds of InconsistentProperties class...");
const c1 = New(InconsistentProperties, true);
const c2 = New(InconsistentProperties, false);

// Verify 'leaking this' problem is solved.
const allInstances = new Set();

class LeakingThis extends DefendedBase {
	constructor()
	{
		super();
		
		allInstances.add(this);
	}
}

const c3 = New(LeakingThis);
console.log("Is 'leaking this' problem solved: " + allInstances.has(c3));

// Finally, test forgetting to create a defended class with New().
// Logs: "An object derived from DefendedBase was not created with New(). This will disable some checks. Possible affected class names: Test"
console.log("Creating a defended class without the New() function...");
const c4 = new Test();