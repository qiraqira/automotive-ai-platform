// Source independence / information-origin graph (extension §52-54):
// "не считать 10 сайтов, перепечатавших один пресс-релиз, десятью
// независимыми источниками." Ten SourceArticles that all cite the same
// primary release are one information origin, not ten independent
// confirmations — this is what the research/fact-checking stages need to
// call before treating source *count* as source *diversity*.

export interface SourceArticleForIndependence {
  id: string;
  /** The primary source (press release, official statement, first report)
   * this article cites/republishes, if one is detectable. Absent when the
   * article itself IS the primary source (an official press release) or
   * is genuinely independent original reporting. */
  originUrl?: string | null;
}

export interface InformationOrigin {
  /** originUrl for a shared-origin group; the article's own id when it's
   * an independent/primary piece with no detected origin. */
  originKey: string;
  articleIds: string[];
}

export function groupByInformationOrigin(articles: SourceArticleForIndependence[]): InformationOrigin[] {
  const groups = new Map<string, string[]>();

  for (const article of articles) {
    const key = article.originUrl ?? article.id;
    const existing = groups.get(key);
    if (existing) {
      existing.push(article.id);
    } else {
      groups.set(key, [article.id]);
    }
  }

  return [...groups.entries()].map(([originKey, articleIds]) => ({ originKey, articleIds }));
}

/** The number this feeds into research/fact-checking: how many genuinely
 * independent origins back a claim, not how many articles mention it. */
export function countIndependentOrigins(articles: SourceArticleForIndependence[]): number {
  return groupByInformationOrigin(articles).length;
}
