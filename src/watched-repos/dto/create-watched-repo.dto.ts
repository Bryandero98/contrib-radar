import { ApiProperty } from '@nestjs/swagger';

export class CreateWatchedRepoDto {
  @ApiProperty({
    example: 'fluxcd',
    description: 'GitHub org/user that owns the repo.',
  })
  owner!: string;

  @ApiProperty({
    example: 'source-controller',
    description: 'Repo name (without the owner).',
  })
  name!: string;

  @ApiProperty({
    example: ['good first issue'],
    required: false,
    description:
      'Issue labels to score - defaults to ["good first issue"] if omitted.',
  })
  labelFilter?: string[];
}
