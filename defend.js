
let mode = "defend";
const VALID_MODES = new Set(["defend", "seal", "off"]);

let logDefendedObjectWarning = function (msg)
{
	console.warn("[Defend-check] " + msg + " @", GetCallStack());
}

function SetMode(m)
{
	if (!VALID_MODES.has(m))
		throw new Error("invalid mode");
	
	mode = m;
}

function SetWarningCallback(f)
{
	if (typeof f !== "function")
		throw new TypeError("expected function");
	
	logDefendedObjectWarning = f;
}

function GetCallStack()
{
	return (new Error()).stack;
}

// Try to get a useful name from an object
function getName(o)
{
	if (o === null)
		return "null";
	
	const type = typeof o;
	
	if (type === "undefined")
		return "undefined";
	
	if (type === "boolean" || type === "number" || type === "string")
		return `<${type}>`;
	
	if (Array.isArray(o))
		return "<array>";
	
	if (type === "symbol")
		return "<" + o.toString() + ">";	// use symbol toString since it includes the symbol name if any, e.g. <Symbol(foo)>
	
	if (type === "function")
	{
		if (o.name && o.name !== "Function")
			return o.name;
		
		return "<anonymous function>";
	}
	
	if (type === "object")
	{
		if (o.constructor && o.constructor.name && o.constructor.name !== "Object")
			return o.constructor.name;
		
		return "<anonymous object>";
	}
	
	return "<unknown>";
}

// Substitute for 'typeof' with two changes:
// - null returns "null" instead of "object"
// - array returns "array" instead of "object"
function getType(o)
{
	if (o === null)
		return "null";
	
	if (Array.isArray(o))
		return "array";
	
	return typeof o;
}

// For a defended object property, check if the changing type is valid. For example a "number" property cannot be changed to a "string".
// Note there are holes in this system, such as being able to change an array to an object by setting it to null first. However this is unlikely
// to happen accidentally and should still help catch mistakes.
function isValidTypeChange(from, to)
{
	const fromType = getType(from);
	const toType = getType(to);
	
	// Allow any type to go to or from null. This is basically for optional types, e.g. an optional string where "null" represents missing value
	if (fromType === "null" || toType === "null")
		return true;
	
	// Undefined properties are not allowed. 'null' should always be used in favour of 'undefined' for properties that exist.
	if (fromType === "undefined" || toType === "undefined")
		return false;
	
	// For all other cases, the type must stay the same.
	return fromType === toType;
}

// During the construction of objects, it's valid for objects to be adding new properties, and we don't want to show any warnings for
// "setting non-existent property" during object construction. To mitigate this DefendedBase adds the real object and Proxy to these
// maps, and the surrounding Defend() call removes them again. In between if any of the Proxy checks see a new property being added
// and the target is in one of these maps, the warning is silenced and the property added.
const ctorObjectToProxy = new Map();
const ctorProxyToObject = new Map();

// WeakMap of Proxy to real object reference, so Release(o) can convert its Proxy to real object for checking revoked access.
const proxyToObject = new WeakMap();

// WeakMap of objects that have had Release(o) called on them, which bans any further accesses on that object. The map is weak so the
// released objects can still be collected. These are the real object references, not Proxies (Release() converts using proxyToObject).
// Each released object is mapped to the call stack at the time it was released to help with debugging.
const releasedObjects = new WeakMap();

// Valid keys to return undefined for in defended property accesses.
const VALID_GET_MISSING_KEYS = new Set([
	"then",				// Looked up by Promise to check if objects are "thenable". Must return undefined if missing for promise chain to work normally.
	"splice"            // not sure why this keeps coming up?
]);

const defendHandler = {
	get(target, key)
	{
		// Note some keys are whitelisted and don't log a message, since they are required for standard features of Javascript to work.
		// Symbols are also ignored, since some features require checks for the presence of optional built-in symbols.
		if (!(key in target) && typeof key !== "symbol" && !VALID_GET_MISSING_KEYS.has(key))
		{
			logDefendedObjectWarning(`Accessed missing property '${key}' from defended object '${getName(target)}', returning undefined`);
		}
		
		// Revoke access after a Release() call. (Also needs to ignore certain language-level accesses.)
		if (releasedObjects.has(target) && typeof key !== "symbol" && !VALID_GET_MISSING_KEYS.has(key))
		{
			logDefendedObjectWarning(`Accessed property '${key}' on a released object '${getName(target)}'\nObject was originally released at: ${releasedObjects.get(target)})\nCall stack at access: `);
		}
		
		return target[key];
	},
	
	set(target, key, value)
	{
		let ok = true;
		
		// Revoke access after a Release() call.
		if (releasedObjects.has(target))
		{
			logDefendedObjectWarning(`Set property '${key}' on a released object '${getName(target)}'\nObject was originally released at: ${releasedObjects.get(target)})\nCall stack at access: `);
			ok = false;
		}
		// Note during construction, sets are allowed on missing properties, so ignore if the target is in ctorObjectToProxy.
		// Otherwise log that new properties cannot be set after ctor.
		else if (!(key in target) && !ctorObjectToProxy.has(target))
		{
			logDefendedObjectWarning(`Set non-existent property '${key}' to '${value}' on defended object '${getName(target)}'`);
			ok = false;
		}
		// As above, ignore this in constructors, otherwise it keeps reporting that the type is changing from "undefined".
		else if (!isValidTypeChange(target[key], value) && !ctorObjectToProxy.has(target))
		{
			// Example message: "Set 'number' property '_width' to type 'object' on defended object 'Pane'"
			logDefendedObjectWarning(`Set '${getType(target[key])}' property '${key}' to type '${getType(value)}' on defended object '${getName(target)}'`);
			ok = false;
		}
		
		// Only perform assignment if it was valid
		if (ok)
			target[key] = value;
		
		// Return true indicating trap succeeded, otherwise it throws an exception
		return true;
	},
	
	deleteProperty(target, key)
	{
		throw new ReferenceError(`Cannot delete property '${key}' from defended object '${getName(target)}'`);
	},
	
	defineProperty(target, key, desc)
	{
		throw new ReferenceError(`Cannot define property '${key}' on defended object '${getName(target)}'`);
	}
}

// To verify that Defend() is used for all DefendedBase objects, DefendedBase sets a timer to call this function.
// It checks that the being-constructed object maps are empty. If a call to Defend() was omitted, the maps will still
// have some entries and this will log a warning.
let checkTimerId = -1;

function CheckDefendedObjectsUsedCorrectly()
{
	checkTimerId = -1;
	
	if (ctorObjectToProxy.size > 0 || ctorProxyToObject.size > 0)
	{
		const uniqueNames = new Set([...ctorObjectToProxy.keys()].map(o => getName(o)));
		const leftoverNames = [...uniqueNames].join(",");
		
		logDefendedObjectWarning(`An object derived from DefendedBase was not created with New(). This will disable some checks. Possible affected class names: ${leftoverNames}`);
		
		// Clear arrays so warnings only appear once
		ctorObjectToProxy.clear();
		ctorProxyToObject.clear();
	}
}

// Base class for objects to be defended. Objects must derive from this in order to have checks made.
class DefendedBase {
	constructor()
	{
		// If disabled simply return undefined. This allows normal object construction.
		if (mode !== "defend")
			return;
		
		// In defended mode, create a new object with the new target prototype. This basically creates a new empty
		// object of the right kind of class. Then this object is wrapped in a Proxy and returned from this constructor.
		// All derived constructors then have the Proxy as 'this', ensuring if 'this' is passed anywhere else it is
		// still the Proxy reference and not the real object. The defend checks are disabled during construction by
		// checking the ctor maps.
		const newTarget = new.target;
		const realObject = Object.create(newTarget.prototype);
		const proxy = new Proxy(realObject, defendHandler);
		
		ctorObjectToProxy.set(realObject, proxy);
		ctorProxyToObject.set(proxy, realObject);
		proxyToObject.set(proxy, realObject);		// weak version
		
		// To ensure the result is wrapped in a Defend() call, set a callback to verify the maps are empty.
		if (checkTimerId === -1)
			checkTimerId = setTimeout(CheckDefendedObjectsUsedCorrectly, 0);
		
		return proxy;
	}
}

function Defend(o)
{
	if (!o || typeof o !== "object")
		throw new TypeError("expected object");
	
	// For fully-defended Proxy wrapped objects the passed object must be a derivative of DefendedBase
	// so that it has constructed on a Proxy. Defending must also be enabled.
	if (mode === "defend" && (o instanceof DefendedBase))
	{
		// Note if the proxy map entry is already missing, just pass through the object. This is so that
		// Defend(Defend(New(Something))) just passes through on the second call, since
		// the object has already finished constructing and has been fully defended already.
		if (!ctorProxyToObject.has(o))
			return o;
		
		const realObject = ctorProxyToObject.get(o);
		ctorProxyToObject.delete(o);
		ctorObjectToProxy.delete(realObject);
		
		return o;
	}
	else if (mode === "seal")
	{
		// In "seal" mode, fall back to sealing the object (which checks for setting non-existent properties) as
		// weaker but lower overhead checks, possibly suitable for a release or testing release build.
		return Object.seal(o);
	}
	else
	{
		// Defending disabled: simply return the raw object as usual.
		return o;
	}
}

// Map of type -> list of properties to verify every constructed object has a consistent set of properties.
// This helps to detect cases like conditionally adding properties in a constructor.
const typeProperties = new Map();

function GetObjectPropertySet(o)
{
	const ret = new Set();
	
	for (const k in o)
		ret.add(k);
	
	return ret;
}

function VerifyObjectPropertiesConsistent(Type, o)
{
	const properties = GetObjectPropertySet(o);
	const existingProperties = typeProperties.get(Type);
	
	if (existingProperties)
	{
		const inconsistentProperties = [];
		
		for (const k of existingProperties.values())
		{
			// Remove properties that are in common, which will leave 'properties' with keys that are not in 'existingProperties'.
			if (properties.has(k))
			{
				properties.delete(k);
			}
			// Otherwise this is an inconsistent property, because it is in 'existingProperties' but not 'properties'.
			else
			{
				inconsistentProperties.push(k);
			}
		}
		
		// 'properties' is left with keys that aren't in 'existingProperties'. All of these are also inconsistent properties.
		inconsistentProperties.push(...properties);
		
		// Report the inconsistent properties if any.
		if (inconsistentProperties.length)
		{
			logDefendedObjectWarning(`'${getName(Type)}' constructor creates inconsistent properties: ${inconsistentProperties.join(", ")}`);
		}
	}
	else
	{
		// first construction of this type: record its property set to compare later objects to
		typeProperties.set(Type, properties);
	}
}

function New(Type, ...args)
{
	if (typeof Type !== "function")
		throw new TypeError("expected function");
	
	let o;
	
	try {
		o = new Type(...args);
	}
	catch (e) {
		// If an exception escapes the constructor, all constructed objects will be cancelled.
		// Clear the constructing-object maps to prevent logging an error.
		ctorProxyToObject.clear();
		ctorObjectToProxy.clear();
		
		throw e;
	}
	
	if (mode === "defend")
		VerifyObjectPropertiesConsistent(Type, o);
	
	return Defend(o);
}

function Release(o)
{
	// Add to WeakMap of released objects. This revokes any access to the object in the defended handler.
	// Note we are passed the Proxy which wraps the real object. Use our proxy -> real object WeakMap
	// to get the real object, then add this to the map of released objects along with the call stack
	// at the time it was released to help with diagnostics.
	const realObject = proxyToObject.get(o);
	
	if (realObject)
		releasedObjects.set(realObject, GetCallStack());
}

function WasReleased(o)
{
	const realObject = proxyToObject.get(o);
	
	// There is no real object mapped to the provided proxy, return false
	if (!realObject)
		return false;
	
	// There is a real object mapped to the provided proxy, check if it was released
	return !!releasedObjects.get(realObject);
}

export {
	SetMode,
	SetWarningCallback,
	DefendedBase,
	New,
	Release,
	WasReleased
}