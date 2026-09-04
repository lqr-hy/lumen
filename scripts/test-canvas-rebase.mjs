import assert from 'node:assert/strict'
import {
  createCanvasLeaseSnapshot,
  findChangedLeaseElements,
} from '../src/features/ai/canvas-rebase.ts'

const document = {
  version: 1,
  elements: [
    {
      id: 'a',
      artboardId: 'board',
      type: 'text',
      content: 'A',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      zIndex: 1,
      style: { color: '#111', fontSize: 12 },
    },
    {
      id: 'b',
      artboardId: 'board',
      type: 'text',
      content: 'B',
      x: 0,
      y: 20,
      width: 10,
      height: 10,
      zIndex: 2,
      style: { color: '#111', fontSize: 12 },
    },
  ],
}
const snapshot = createCanvasLeaseSnapshot(document, 'board')
const changedElsewhere = {
  ...document,
  version: 2,
  elements: document.elements.map((item) => (item.id === 'b' ? { ...item, content: 'B2' } : item)),
}
assert.deepEqual(findChangedLeaseElements(changedElsewhere, 'board', snapshot, ['a']), [])
assert.deepEqual(findChangedLeaseElements(changedElsewhere, 'board', snapshot, ['b']), ['b'])
console.log(JSON.stringify({ unrelatedEditRebased: true, targetEditRejected: true }, null, 2))
