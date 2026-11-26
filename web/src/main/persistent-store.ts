export interface IndexedSequence<T> extends Iterable<T> {
  readonly length: number;
  at(index: number): T | undefined;
  slice(start?: number, end?: number): T[];
}
interface Node<K, V, A> {
  readonly key: K;
  readonly value: V;
  readonly left: Node<K, V, A> | null;
  readonly right: Node<K, V, A> | null;
  readonly height: number;
  readonly size: number;
  readonly aggregate: A;
}
export interface TreeConfig<K, V, A> {
  compare(a: K, b: K): number;
  empty: A;
  combine(left: A, value: V, right: A): A;
}
const height = (node: Node<unknown, unknown, unknown> | null) => node?.height ?? 0;
const size = (node: Node<unknown, unknown, unknown> | null) => node?.size ?? 0;
/** AVL path copying bounds both updates and lookups without overlay chains. */
export class PersistentTree<K, V, A = undefined> implements Iterable<[K, V]> {
  readonly root: Node<K, V, A> | null;
  readonly config: TreeConfig<K, V, A>;
  constructor(config: TreeConfig<K, V, A>, root: Node<K, V, A> | null = null) {
    this.config = config;
    this.root = root;
  }
  get size(): number { return size(this.root); }
  get aggregate(): A { return this.root?.aggregate ?? this.config.empty; }
  get(key: K): V | undefined {
    let node = this.root;
    while (node) {
      const order = this.config.compare(key, node.key);
      if (order === 0) return node.value;
      node = order < 0 ? node.left : node.right;
    }
    return undefined;
  }
  private node(key: K, value: V, left: Node<K, V, A> | null, right: Node<K, V, A> | null): Node<K, V, A> {
    return { key, value, left, right, height: 1 + Math.max(height(left), height(right)), size: 1 + size(left) + size(right), aggregate: this.config.combine(left?.aggregate ?? this.config.empty, value, right?.aggregate ?? this.config.empty) };
  }
  private balance(node: Node<K, V, A>): Node<K, V, A> {
    if (height(node.left) - height(node.right) > 1) {
      let left = node.left!;
      if (height(left.left) < height(left.right)) {
        const middle = left.right!;
        left = this.node(middle.key, middle.value, this.node(left.key, left.value, left.left, middle.left), middle.right);
      }
      return this.node(left.key, left.value, left.left, this.node(node.key, node.value, left.right, node.right));
    }
    if (height(node.right) - height(node.left) > 1) {
      let right = node.right!;
      if (height(right.right) < height(right.left)) {
        const middle = right.left!;
        right = this.node(middle.key, middle.value, middle.left, this.node(right.key, right.value, middle.right, right.right));
      }
      return this.node(right.key, right.value, this.node(node.key, node.value, node.left, right.left), right.right);
    }
    return node;
  }
  set(key: K, value: V): PersistentTree<K, V, A> {
    const put = (node: Node<K, V, A> | null): Node<K, V, A> => {
      if (!node) return this.node(key, value, null, null);
      const order = this.config.compare(key, node.key);
      if (order === 0) return node.value === value ? node : this.node(key, value, node.left, node.right);
      const child = put(order < 0 ? node.left : node.right);
      if (child === (order < 0 ? node.left : node.right)) return node;
      return this.balance(this.node(node.key, node.value, order < 0 ? child : node.left, order < 0 ? node.right : child));
    };
    const root = put(this.root);
    return root === this.root ? this : new PersistentTree(this.config, root);
  }
  delete(key: K): PersistentTree<K, V, A> {
    const remove = (node: Node<K, V, A> | null): Node<K, V, A> | null => {
      if (!node) return null;
      const order = this.config.compare(key, node.key);
      if (order === 0) {
        if (!node.left) return node.right;
        if (!node.right) return node.left;
        let next = node.right;
        while (next.left) next = next.left;
        const dropFirst = (child: Node<K, V, A>): Node<K, V, A> | null => child.left ? this.balance(this.node(child.key, child.value, dropFirst(child.left), child.right)) : child.right;
        return this.balance(this.node(next.key, next.value, node.left, dropFirst(node.right)));
      }
      const child = remove(order < 0 ? node.left : node.right);
      if (child === (order < 0 ? node.left : node.right)) return node;
      return this.balance(this.node(node.key, node.value, order < 0 ? child : node.left, order < 0 ? node.right : child));
    };
    const root = remove(this.root);
    return root === this.root ? this : new PersistentTree(this.config, root);
  }
  at(index: number): V | undefined {
    if (index < 0) index += this.size;
    let node = this.root;
    while (node && index >= 0) {
      const before = size(node.left);
      if (index === before) return node.value;
      if (index < before) node = node.left;
      else { index -= before + 1; node = node.right; }
    }
    return undefined;
  }
  rank(key: K): number {
    let node = this.root, count = 0;
    while (node) {
      if (this.config.compare(key, node.key) <= 0) node = node.left;
      else { count += size(node.left) + 1; node = node.right; }
    }
    return count;
  }
  slice(start = 0, end = this.size): V[] {
    const result: V[] = [];
    const visit = (node: Node<K, V, A> | null, offset: number): void => {
      if (!node || offset >= end || offset + node.size <= start) return;
      const index = offset + size(node.left);
      visit(node.left, offset);
      if (index >= start && index < end) result.push(node.value);
      visit(node.right, index + 1);
    };
    visit(this.root, 0);
    return result;
  }
  *[Symbol.iterator](): IterableIterator<[K, V]> {
    function* walk(node: Node<K, V, A> | null): IterableIterator<[K, V]> {
      if (!node) return;
      yield* walk(node.left);
      yield [node.key, node.value];
      yield* walk(node.right);
    }
    yield* walk(this.root);
  }
  *values(): IterableIterator<V> { for (const [, value] of this) yield value; }
}
export function keyedStore<K extends string | number, V>(): PersistentTree<K, V> {
  return new PersistentTree({ compare: (a, b) => {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    const left = String(a), right = String(b);
    return left < right ? -1 : left > right ? 1 : 0;
  }, empty: undefined, combine: () => undefined });
}
const sequenceConfig: TreeConfig<number, unknown, undefined> = { compare: (a, b) => a - b, empty: undefined, combine: () => undefined };
export class PersistentSequence<T> implements IndexedSequence<T> {
  readonly tree: PersistentTree<number, T>;
  constructor(tree = new PersistentTree<number, T>(sequenceConfig as TreeConfig<number, T, undefined>)) { this.tree = tree; }
  get length(): number { return this.tree.size; }
  at(index: number): T | undefined { return this.tree.at(index); }
  slice(start = 0, end = this.length): T[] { return this.tree.slice(start < 0 ? Math.max(0, this.length + start) : start, end < 0 ? Math.max(0, this.length + end) : end); }
  append(value: T): PersistentSequence<T> { return new PersistentSequence(this.tree.set(this.length, value)); }
  [Symbol.iterator](): IterableIterator<T> { return this.tree.values(); }
}
