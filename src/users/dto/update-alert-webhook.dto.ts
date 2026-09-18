import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUrl } from 'class-validator';

export class UpdateAlertWebhookDto {
  @ApiProperty({
    example: 'https://hooks.slack.com/services/T000/B000/xxxxxxxx',
    nullable: true,
    description:
      'A Slack incoming-webhook URL, notified on every new issue found on a watched repo. null disables alerts.',
  })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  webhookUrl!: string | null;
}
