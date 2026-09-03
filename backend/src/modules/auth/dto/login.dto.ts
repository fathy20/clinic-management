import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class LoginDto {
  /** Email or phone. Staff authenticate with one of the two (FR-IAM-01). */
  @IsString()
  @IsNotEmpty()
  identifier!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  /** Required only when the account belongs to more than one clinic. */
  @IsOptional()
  @IsUUID()
  clinicId?: string;
}
