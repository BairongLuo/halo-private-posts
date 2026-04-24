declare module 'scrypt-js' {
  export function scrypt(
    password: ArrayLike<number>,
    salt: ArrayLike<number>,
    N: number,
    r: number,
    p: number,
    dkLen: number,
    progressCallback?: (progress: number) => void
  ): Promise<Uint8Array>
}
