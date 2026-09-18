import { AlertsService, type NewIssueAlert } from './alerts.service';

function sampleIssue(overrides: Partial<NewIssueAlert> = {}): NewIssueAlert {
  return {
    owner: 'fluxcd',
    name: 'source-controller',
    number: 42,
    title: 'Flaky reconcile test',
    url: 'https://github.com/fluxcd/source-controller/issues/42',
    score: 87,
    ...overrides,
  };
}

type FetchMock = jest.Mock<
  Promise<{ ok: boolean; status: number }>,
  [string, RequestInit]
>;

function sentBody(fetchMock: FetchMock, callIndex: number): { text: string } {
  const [, init] = fetchMock.mock.calls[callIndex];
  return JSON.parse(init.body as string) as { text: string };
}

describe('AlertsService', () => {
  let service: AlertsService;
  let fetchMock: FetchMock;

  beforeEach(() => {
    service = new AlertsService();
    fetchMock = jest.fn<
      Promise<{ ok: boolean; status: number }>,
      [string, RequestInit]
    >();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('does nothing when there are no new issues', async () => {
    await service.notifyNewIssues('https://hooks.slack.com/services/x', []);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs a Slack-shaped payload for a single new issue', async () => {
    await service.notifyNewIssues('https://hooks.slack.com/services/x', [
      sampleIssue(),
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/x',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const body = sentBody(fetchMock, 0);
    expect(body.text).toContain('fluxcd/source-controller#42');
    expect(body.text).toContain('Flaky reconcile test');
  });

  it('batches multiple new issues into one message', async () => {
    await service.notifyNewIssues('https://hooks.slack.com/services/x', [
      sampleIssue({ number: 1 }),
      sampleIssue({ number: 2 }),
    ]);

    const body = sentBody(fetchMock, 0);
    expect(body.text).toContain('2 new scored issues');
    expect(body.text).toContain('#1');
    expect(body.text).toContain('#2');
  });

  it('swallows a network error instead of throwing', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      service.notifyNewIssues('https://hooks.slack.com/services/x', [
        sampleIssue(),
      ]),
    ).resolves.toBeUndefined();
  });

  it('swallows a non-ok response instead of throwing', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    await expect(
      service.notifyNewIssues('https://hooks.slack.com/services/x', [
        sampleIssue(),
      ]),
    ).resolves.toBeUndefined();
  });
});
