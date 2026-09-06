import { GithubGraphqlProvider } from './github-graphql.provider';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

const rateLimit = { cost: 1, remaining: 4999, resetAt: '2026-09-06T00:00:00Z' };

const baseIssueNode = {
  number: 1,
  title: 'Some issue',
  url: 'https://github.com/o/r/issues/1',
  state: 'OPEN',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  labels: { nodes: [{ name: 'good first issue' }] },
  assignees: { nodes: [] },
  comments: {
    pageInfo: { hasPreviousPage: false, startCursor: null },
    nodes: [
      {
        author: { login: 'someone' },
        authorAssociation: 'NONE',
        body: 'I can take this',
        createdAt: '2026-01-03T00:00:00Z',
      },
    ],
  },
  timelineItems: {
    nodes: [
      {
        isCrossRepository: false,
        source: {
          number: 42,
          url: 'https://github.com/o/r/pull/42',
          state: 'OPEN',
          isDraft: false,
          merged: false,
        },
      },
      {
        // cross-repo references (e.g. a fork mentioning the issue) are
        // not a same-repo competing PR and must be filtered out
        isCrossRepository: true,
        source: {
          number: 7,
          url: 'https://github.com/other/fork/pull/7',
          state: 'OPEN',
          isDraft: false,
          merged: false,
        },
      },
    ],
  },
};

describe('GithubGraphqlProvider', () => {
  let provider: GithubGraphqlProvider;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'test-token';
    provider = new GithubGraphqlProvider();
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('throws clearly when GITHUB_TOKEN is missing', async () => {
    delete process.env.GITHUB_TOKEN;

    await expect(
      provider.fetchIssuesForScoring({ owner: 'o', name: 'r', labels: [] }),
    ).rejects.toThrow(/GITHUB_TOKEN is required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a single page of issues, filtering out cross-repository PR references', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        data: {
          rateLimit,
          repository: {
            issues: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [baseIssueNode],
            },
          },
        },
      }),
    );

    const issues = await provider.fetchIssuesForScoring({
      owner: 'o',
      name: 'r',
      labels: ['good first issue'],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      number: 1,
      labels: ['good first issue'],
      assigneeLogins: [],
      crossReferencingPullRequests: [
        {
          number: 42,
          url: 'https://github.com/o/r/pull/42',
          state: 'OPEN',
          isDraft: false,
          merged: false,
        },
      ],
    });
  });

  it('paginates across multiple pages, passing the previous endCursor forward', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: {
            rateLimit,
            repository: {
              issues: {
                pageInfo: { hasNextPage: true, endCursor: 'CURSOR_1' },
                nodes: [{ ...baseIssueNode, number: 1 }],
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: {
            rateLimit,
            repository: {
              issues: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [{ ...baseIssueNode, number: 2 }],
              },
            },
          },
        }),
      );

    const issues = await provider.fetchIssuesForScoring({
      owner: 'o',
      name: 'r',
      labels: [],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(issues.map((i) => i.number)).toEqual([1, 2]);
    const secondCallInit = fetchMock.mock.calls[1][1] as RequestInit;
    const secondCallBody = JSON.parse(secondCallInit.body as string) as {
      variables: { after: string | null };
    };
    expect(secondCallBody.variables.after).toBe('CURSOR_1');
  }, 10000);

  it('retries once with backoff on a 429, then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, {}))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: {
            rateLimit,
            repository: {
              issues: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [baseIssueNode],
              },
            },
          },
        }),
      );

    const issues = await provider.fetchIssuesForScoring({
      owner: 'o',
      name: 'r',
      labels: [],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(issues).toHaveLength(1);
  }, 10000);

  it('surfaces GraphQL-level errors instead of returning empty/partial data', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        errors: [{ message: 'Could not resolve to a Repository' }],
      }),
    );

    await expect(
      provider.fetchIssuesForScoring({ owner: 'o', name: 'r', labels: [] }),
    ).rejects.toThrow(/Could not resolve to a Repository/);
  });

  it('fetches an older comment page when the last 20 contain zero maintainer comments', async () => {
    const issueWithNoMaintainerComment = {
      ...baseIssueNode,
      comments: {
        pageInfo: { hasPreviousPage: true, startCursor: 'COMMENT_CURSOR' },
        nodes: [
          {
            author: { login: 'someone' },
            authorAssociation: 'NONE',
            body: 'me too',
            createdAt: '2026-01-03T00:00:00Z',
          },
        ],
      },
    };

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: {
            rateLimit,
            repository: {
              issues: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [issueWithNoMaintainerComment],
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: {
            repository: {
              issue: {
                comments: {
                  nodes: [
                    {
                      author: { login: 'a-maintainer' },
                      authorAssociation: 'MEMBER',
                      body: 'This is risky, best left untouched',
                      createdAt: '2026-01-01T00:00:00Z',
                    },
                  ],
                },
              },
            },
          },
        }),
      );

    const issues = await provider.fetchIssuesForScoring({
      owner: 'o',
      name: 'r',
      labels: [],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(issues[0].maintainerCommentsFullyChecked).toBe(true);
    expect(issues[0].comments).toContainEqual(
      expect.objectContaining({
        authorAssociation: 'MEMBER',
        body: 'This is risky, best left untouched',
      }),
    );
  }, 10000);

  it('does not fetch an older page when a maintainer comment is already present', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        data: {
          rateLimit,
          repository: {
            issues: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  ...baseIssueNode,
                  comments: {
                    pageInfo: { hasPreviousPage: true, startCursor: 'X' },
                    nodes: [
                      {
                        author: { login: 'maintainer' },
                        authorAssociation: 'OWNER',
                        body: 'looks good',
                        createdAt: '2026-01-03T00:00:00Z',
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      }),
    );

    await provider.fetchIssuesForScoring({ owner: 'o', name: 'r', labels: [] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
