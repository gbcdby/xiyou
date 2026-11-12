interface VisiblePerson { entityRef: string; name: string }

/** 临时编号只关联当前授权视图内的对象；不推断同名人物的身份，也不跨视图保留。 */
export class SpatialPersonLabels {
  #view: string | null = null;
  #markers = new Map<string, number>();
  #next = 1;
  clear() { this.#view = null; this.#markers.clear(); this.#next = 1; }
  update(view: string | null, people: VisiblePerson[]): Record<string, string> {
    if (view !== this.#view) { this.clear(); this.#view = view; }
    if (!view) return {};
    for (const person of people) if (!this.#markers.has(person.entityRef)) this.#markers.set(person.entityRef, this.#next++);
    // 每个人都有唯一前置编号，因此合法姓名即使包含编号格式也不会与另一项同文。
    return Object.fromEntries(people.map(person => [person.entityRef, `${this.#markers.get(person.entityRef)}号 · ${person.name}`]));
  }
}
