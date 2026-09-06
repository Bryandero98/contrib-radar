import { GeminiSentimentProvider } from './gemini-sentiment.provider';

function geminiResponse(parsedBody: unknown) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        candidates: [
          { content: { parts: [{ text: JSON.stringify(parsedBody) }] } },
        ],
      }),
    text: () => Promise.resolve(''),
  };
}

describe('GeminiSentimentProvider', () => {
  const originalApiKey = process.env.GEMINI_API_KEY;
  const originalFetch = global.fetch;
  let provider: GeminiSentimentProvider;

  beforeEach(() => {
    provider = new GeminiSentimentProvider();
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalApiKey;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('throws a clear error when GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(
      provider.classify({ issueTitle: 't', maintainerComments: [] }),
    ).rejects.toThrow('GEMINI_API_KEY is required');
  });

  it('requests structured output and returns the parsed label/rationale', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const fetchMock = jest.fn().mockResolvedValue(
      geminiResponse({
        label: 'discouraged',
        rationale: 'Maintainer pushed back on the approach.',
      }),
    );
    global.fetch = fetchMock;

    const result = await provider.classify({
      issueTitle: 'Disable tqdm watchdog thread',
      maintainerComments: [
        {
          body: 'Disabling a feature to bypass a bug is not a good idea',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    });

    expect(result).toEqual({
      label: 'discouraged',
      rationale: 'Maintainer pushed back on the approach.',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(url).toContain('key=test-key');
    const body = JSON.parse(init.body as string) as {
      generationConfig: { responseMimeType: string; responseSchema: unknown };
    };
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema).toMatchObject({
      type: 'OBJECT',
      required: ['label', 'rationale'],
    });
  });

  it('rejects a schema-valid but out-of-enum label instead of trusting it blindly', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        geminiResponse({ label: 'very_encouraged', rationale: 'x' }),
      );

    await expect(
      provider.classify({
        issueTitle: 't',
        maintainerComments: [{ body: 'x', createdAt: '2026-01-01T00:00:00Z' }],
      }),
    ).rejects.toThrow(/unrecognized sentiment label/);
  });

  it('throws with the status and body when Gemini returns an error response', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('{"error":"invalid api key"}'),
    });

    await expect(
      provider.classify({
        issueTitle: 't',
        maintainerComments: [{ body: 'x', createdAt: '2026-01-01T00:00:00Z' }],
      }),
    ).rejects.toThrow(/Gemini sentiment request failed \(401\)/);
  });

  it('retries after a 429 and returns the result from the retry', async () => {
    jest.useFakeTimers();
    process.env.GEMINI_API_KEY = 'test-key';
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: () => Promise.resolve('rate limited'),
      })
      .mockResolvedValueOnce(
        geminiResponse({
          label: 'encouraged',
          rationale: 'Maintainer welcomed it.',
        }),
      );
    global.fetch = fetchMock;

    const resultPromise = provider.classify({
      issueTitle: 't',
      maintainerComments: [{ body: 'x', createdAt: '2026-01-01T00:00:00Z' }],
    });
    await jest.advanceTimersByTimeAsync(1000);
    const result = await resultPromise;

    expect(result.label).toBe('encouraged');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('retries after a 503 (model overloaded) and returns the result from the retry', async () => {
    jest.useFakeTimers();
    process.env.GEMINI_API_KEY = 'test-key';
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: () => Promise.resolve('overloaded'),
      })
      .mockResolvedValueOnce(
        geminiResponse({ label: 'neutral', rationale: 'No strong signal.' }),
      );
    global.fetch = fetchMock;

    const resultPromise = provider.classify({
      issueTitle: 't',
      maintainerComments: [{ body: 'x', createdAt: '2026-01-01T00:00:00Z' }],
    });
    await jest.advanceTimersByTimeAsync(1000);
    const result = await resultPromise;

    expect(result.label).toBe('neutral');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});
