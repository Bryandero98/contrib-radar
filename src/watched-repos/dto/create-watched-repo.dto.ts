import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateWatchedRepoDto {
  @ApiProperty({
    example: 'fluxcd',
    description: 'GitHub org/user that owns the repo.',
  })
  @IsString()
  @IsNotEmpty()
  owner!: string;

  @ApiProperty({
    example: 'source-controller',
    description: 'Repo name (without the owner).',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    example: ['good first issue'],
    required: false,
    description:
      'Issue labels to score - defaults to ["good first issue"] if omitted.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  labelFilter?: string[];
}
