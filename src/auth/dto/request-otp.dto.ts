import { IsPhoneNumber } from 'class-validator';

export class RequestOtpDto {
  @IsPhoneNumber(undefined, { message: 'Please provide a valid phone number, e.g. +251912345678' })
  phone: string;
}
