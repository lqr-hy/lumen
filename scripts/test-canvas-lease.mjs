import assert from 'node:assert/strict'

function canDeliver(targetRevision, currentRevision) {
  return targetRevision === undefined || targetRevision === currentRevision
}

assert.equal(canDeliver(4, 4), true)
assert.equal(canDeliver(4, 5), false)
assert.equal(canDeliver(undefined, 5), true)

console.log(
  JSON.stringify(
    { leaseMatchesRevision: true, userMutationRejected: true, unversionedTargetCompatible: true },
    null,
    2,
  ),
)
