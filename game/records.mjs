/** 领域 ID 只命中字典的自有记录；原型属性不是角色、物品或知识。 */
export function ownRecord(records, id) {
  if (!records || !Object.hasOwn(records, id)) return undefined;
  const value = records[id];
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}
