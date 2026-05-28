// Lightweight assert shim for environments without Node.js assert support
export default function assert(value, message) {
  if (!value) {
    throw new Error(message || 'Assertion failed');
  }
}
assert.ok = function(value, message) {
  if (!value) {
    throw new Error(message || 'Assertion failed');
  }
};
assert.equal = function(a, b, message) {
  if (a != b) {
    throw new Error(message || `Assertion failed: ${a} == ${b}`);
  }
};
