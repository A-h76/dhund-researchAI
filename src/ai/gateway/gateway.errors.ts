export type GatewayErrorCode =
  | 'capability_role_mismatch'
  | 'embed_dimension_mismatch'
  | 'embed_input_type_missing'
  | 'embed_request_cap_exceeded'
  | 'secret_in_payload'
  | 'validation_error';

export class GatewayError extends Error {
  readonly code: GatewayErrorCode;

  constructor(code: GatewayErrorCode, message: string) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
  }
}
