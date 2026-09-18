import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class DraftClaimDto {
  @ApiProperty({ example: 'a1b2c3d4-...' })
  @IsString()
  @IsNotEmpty()
  watchedRepoId!: string;

  @ApiProperty({ example: 42 })
  @IsInt()
  @Min(1)
  issueNumber!: number;
}
