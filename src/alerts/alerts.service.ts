import { Injectable, Logger } from '@nestjs/common';

export interface NewIssueAlert {
  owner: string;
  name: string;
  number: number;
  title: string;
  url: string;
  score: number;
}

// Best-effort notifications only - a Slack outage or a stale webhook must
// never *fail* a refresh (see RefreshService), so every failure here is
// logged and swallowed, never rethrown. It's still awaited, not detached,
// so a slow-to-respond webhook does add to the refresh's response time -
// the 5s timeout below bounds how much.
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  async notifyNewIssues(
    webhookUrl: string,
    issues: NewIssueAlert[],
  ): Promise<void> {
    if (issues.length === 0) return;

    const lines = issues.map(
      (issue) =>
        `• <${issue.url}|${issue.owner}/${issue.name}#${issue.number}> (score ${issue.score}) - ${issue.title}`,
    );
    const text =
      issues.length === 1
        ? `New scored issue:\n${lines[0]}`
        : `${issues.length} new scored issues:\n${lines.join('\n')}`;

    try {
      // redirect: 'error' - webhookUrl is validated to be hooks.slack.com
      // before it ever reaches here (see isSlackWebhookUrl in
      // users.service.ts), but that check only holds if this fetch never
      // follows a redirect to some other host; fetch() follows redirects
      // by default, so this keeps the validation airtight regardless of
      // Slack's own future behavior.
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        this.logger.warn(
          `Slack webhook responded with ${res.status} - alert not delivered.`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Slack webhook delivery failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
