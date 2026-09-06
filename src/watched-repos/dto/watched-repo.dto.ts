import { ApiProperty } from '@nestjs/swagger';

export class WatchedRepoDto {
  @ApiProperty({ example: 'a1b2c3d4-...' })
  id!: string;

  @ApiProperty({ example: 'fluxcd' })
  owner!: string;

  @ApiProperty({ example: 'source-controller' })
  name!: string;

  @ApiProperty({ example: ['good first issue'] })
  labelFilter!: string[];

  @ApiProperty({ example: '2026-09-06T08:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-09-06T09:00:00.000Z', nullable: true })
  lastRefreshedAt!: string | null;
}
