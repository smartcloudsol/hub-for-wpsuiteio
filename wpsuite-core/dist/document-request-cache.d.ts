/** Return no key when platform hashing is unavailable; callers then load independently. */
export declare function requestKeyDigest(value: string): Promise<string | null>;
/** Public, non-secret context only. Capture it before starting an asynchronous load. */
export declare function requestContext(): string;
export declare function documentRequest<T>(key: string, load: () => Promise<T>, valid: (value: T) => boolean): {
    promise: Promise<T>;
    evict: () => void;
};
