import jwt from "jsonwebtoken";

interface SignOptions {
  issuer?: string;
  /** Seconds */
  expiresIn?: number;
}

/** HS256 tokens with a default issuer; per-call options override it (admin, MFA challenge). */
export class JwtService {
  constructor(
    private readonly secret: string,
    private readonly issuer: string,
  ) {}

  async signAsync(payload: object, options: SignOptions = {}): Promise<string> {
    return jwt.sign(payload, this.secret, { algorithm: "HS256", issuer: options.issuer ?? this.issuer, expiresIn: options.expiresIn });
  }

  verify<T extends object>(token: string, options: Pick<SignOptions, "issuer"> = {}): T {
    return jwt.verify(token, this.secret, { algorithms: ["HS256"], issuer: options.issuer ?? this.issuer }) as T;
  }

  async verifyAsync<T extends object>(token: string, options: Pick<SignOptions, "issuer"> = {}): Promise<T> {
    return this.verify<T>(token, options);
  }
}
