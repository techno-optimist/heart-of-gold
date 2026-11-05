export const RESULT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: { type: 'string' }, result: { type: 'string' },
    children: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      properties: { name: { type: 'string' }, role: { type: 'string' }, task: { type: 'string' } },
      required: ['name', 'role', 'task'],
    } },
  }, required: ['summary', 'result', 'children'],
};

export function validateResult(value) {
  if (!value || typeof value !== 'object' || typeof value.summary !== 'string' || typeof value.result !== 'string' || !Array.isArray(value.children)) throw new Error('Agent returned an invalid structured result.');
  if (!value.children.length && !value.result.trim()) throw new Error('A completed agent must return a nonempty deliverable.');
  if (value.summary.length > 4000 || value.result.length > 24000 || value.children.length > 6) throw new Error('Agent result exceeded the expedition output limits.');
  for (const child of value.children) {
    if (!child || typeof child.name !== 'string' || typeof child.role !== 'string' || typeof child.task !== 'string' || !child.name.trim() || !child.role.trim() || !child.task.trim() || child.name.length > 80 || child.role.length > 120 || child.task.length > 6000) throw new Error('Agent returned an invalid child assignment.');
  }
  return { summary: value.summary, result: value.result, children: value.children.map(({ name, role, task }) => ({ name, role, task })) };
}

