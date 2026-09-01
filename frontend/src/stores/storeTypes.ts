export type StateValue<T> = T | ((current: T) => T);

export function resolveStateValue<T>(value: StateValue<T>, current: T): T {
	return typeof value === 'function' ? (value as (current: T) => T)(current) : value;
}
