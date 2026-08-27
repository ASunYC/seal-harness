const serviceType = Symbol("seal-harness.serviceType");

export interface ServiceToken<T> {
  readonly id: symbol;
  readonly name: string;
  readonly [serviceType]?: T;
}

export type ServiceOf<TToken> = TToken extends ServiceToken<infer TService> ? TService : never;

export function createServiceToken<T>(name: string): ServiceToken<T> {
  const normalizedName = name.trim();
  if (normalizedName.length === 0) {
    throw new TypeError("Service token name must not be empty");
  }

  return Object.freeze({
    id: Symbol(normalizedName),
    name: normalizedName,
  });
}
