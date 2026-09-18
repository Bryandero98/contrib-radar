import { GeminiClaimDecisionProvider } from './gemini-claim-decision.provider';

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

const candidate = {
  issueTitle: 'Fix flaky upload test',
  issueBody: 'The upload test fails intermittently under load.',
  repoOwner: 'o',
  repoName: 'r',
};

describe('GeminiClaimDecisionProvider', () => {
  const originalApiKey = process.env.GEMINI_API_KEY;
  const originalFetch = global.fetch;
  let provider: GeminiClaimDecisionProvider;

  beforeEach(() => {
    provider = new GeminiClaimDecisionProvider();
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalApiKey;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('throws a clear error when GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(provider.decide(candidate)).rejects.toThrow(
      'GEMINI_API_KEY is required',
    );
  });

  it('returns a claim decision with its comment', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue(
      geminiResponse({
        decision: 'claim',
        comment: 'I can take a look at this.',
      }),
    );

    const result = await provider.decide(candidate);

    expect(result).toEqual({
      decision: 'claim',
      comment: 'I can take a look at this.',
    });
  });

  it('strips bidi-control and zero-width characters from the comment before returning it', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    // RLO (U+202E) followed by reversed-looking text and a zero-width
    // space (U+200B) - a Trojan-Source-style trick that could make the
    // comment render differently in the dashboard's textarea than the
    // literal string actually stored/posted.
    global.fetch = jest.fn().mockResolvedValue(
      geminiResponse({
        decision: 'claim',
        comment: 'I can help​ with ‮this one.',
      }),
    );

    const result = await provider.decide(candidate);

    expect(result).toEqual({
      decision: 'claim',
      comment: 'I can help with this one.',
    });
  });

  it('truncates an unreasonably long comment', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        geminiResponse({ decision: 'claim', comment: 'x'.repeat(1000) }),
      );

    const result = await provider.decide(candidate);

    expect(result.decision).toBe('claim');
    expect((result as { comment: string }).comment).toHaveLength(600);
  });

  it('delimits the untrusted issue title/body in the prompt sent to Gemini', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        geminiResponse({ decision: 'claim', comment: 'On it.' }),
      );
    global.fetch = fetchMock;

    await provider.decide(candidate);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      contents: { parts: { text: string }[] }[];
    };
    const prompt = body.contents[0].parts[0].text;
    expect(prompt).toContain('<issue_title>');
    expect(prompt).toContain('<issue_body>');
    expect(prompt).toContain('untrusted data');
  });

  it('returns an abstain decision with its reason', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        geminiResponse({ decision: 'abstain', reason: 'too vague' }),
      );

    const result = await provider.decide(candidate);

    expect(result).toEqual({ decision: 'abstain', reason: 'too vague' });
  });

  it('defaults the abstain reason when Gemini omits one', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    global.fetch = jest
      .fn()
      .mockResolvedValue(geminiResponse({ decision: 'abstain' }));

    const result = await provider.decide(candidate);

    expect(result).toEqual({ decision: 'abstain', reason: 'no reason given' });
  });

  it('throws when Gemini claims but gives no comment, instead of posting an empty one', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    global.fetch = jest
      .fn()
      .mockResolvedValue(geminiResponse({ decision: 'claim' }));

    await expect(provider.decide(candidate)).rejects.toThrow(
      /no comment to post/,
    );
  });

  it('rejects a schema-valid but out-of-enum decision instead of trusting it blindly', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    global.fetch = jest
      .fn()
      .mockResolvedValue(geminiResponse({ decision: 'maybe' }));

    await expect(provider.decide(candidate)).rejects.toThrow(
      /unrecognized claim decision/,
    );
  });

  it('throws with the status and body when Gemini returns an error response', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('{"error":"invalid api key"}'),
    });

    await expect(provider.decide(candidate)).rejects.toThrow(
      /Gemini claim-decision request failed \(401\)/,
    );
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
        geminiResponse({ decision: 'claim', comment: 'On it.' }),
      );
    global.fetch = fetchMock;

    const resultPromise = provider.decide(candidate);
    await jest.advanceTimersByTimeAsync(1000);
    const result = await resultPromise;

    expect(result).toEqual({ decision: 'claim', comment: 'On it.' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});
