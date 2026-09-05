/**
 * LocalDataSource: IndexedDB から読み出す DataSource 実装（Phase 1）。
 *
 * 実体は @/lib/db/repositories の read 関数に委譲する薄いファサード。
 * 検索（search）は Step 4 で SearchEngine を統合するまでスタブ（空配列）。
 */

"use client";

import type {
  DataSource,
  IssueListQuery,
  IssueListPage,
  FilterOptions,
  WikiListQuery,
  WikiListPage,
} from "./types";
import type {
  StoredIssue,
  StoredComment,
  StoredWiki,
  WikiHeading,
  StoredDocument,
  StoredUser,
  AttachmentMeta,
  ProjectMeta,
  NamedColorMaster,
  NamedMaster,
} from "@/types/entities";
import type { SearchHit, SearchKind } from "@/lib/search/types";
import { searchProject } from "@/lib/search/searcher";
import {
  getProjectMetaAll,
  getProjectMeta,
  queryIssues,
  getIssueByKeyId,
  getChildIssues,
  getIssueById,
  getCommentsByIssue,
  getAttachmentsByIssue,
  countIssuesByProject,
  getMastersByKind,
  getAssigneesByProject,
  getUserIcon,
  getProjectIcon,
  getAllUsers,
  queryWikis,
  getWikiById,
  getWikiByName,
  getWikiHeadingsByProject,
  getDocumentsByProject,
  getDocumentById,
} from "@/lib/db/repositories";

export class LocalDataSource implements DataSource {
  listProjects(): Promise<ProjectMeta[]> {
    return getProjectMetaAll();
  }

  getProject(projectId: number): Promise<ProjectMeta | undefined> {
    return getProjectMeta(projectId);
  }

  listIssues(query: IssueListQuery): Promise<IssueListPage> {
    return queryIssues({
      projectId: query.projectId,
      offset: query.offset,
      limit: query.limit,
      sort: query.sort ?? "updated",
      order: query.order ?? "desc",
      filter: query.filter ?? {},
    });
  }

  async getFilterOptions(projectId: number): Promise<FilterOptions> {
    const [
      statusEntries,
      typeEntries,
      categoryEntries,
      milestoneEntries,
      versionEntries,
      assignees,
    ] = await Promise.all([
      getMastersByKind(projectId, "status"),
      getMastersByKind(projectId, "issueType"),
      getMastersByKind(projectId, "category"),
      getMastersByKind(projectId, "milestone"),
      getMastersByKind(projectId, "version"),
      getAssigneesByProject(projectId),
    ]);
    return {
      statuses: statusEntries
        .map((e) => e.master as NamedColorMaster)
        .sort((a, b) => a.id - b.id),
      issueTypes: typeEntries
        .map((e) => e.master as NamedColorMaster)
        .sort((a, b) => a.id - b.id),
      categories: categoryEntries
        .map((e) => e.master as NamedMaster)
        .sort((a, b) => a.id - b.id),
      // マイルストーン・発生バージョンは課題埋め込みの {id,name} からしか集められず、
      // Backlog の表示順（displayOrder）を持たない。本家 Backlog は新しく作ったものほど上に
      // 並べる（＝id 降順）ため、それに合わせて id の降順でソートする。
      milestones: milestoneEntries
        .map((e) => e.master as NamedMaster)
        .sort((a, b) => b.id - a.id),
      versions: versionEntries
        .map((e) => e.master as NamedMaster)
        .sort((a, b) => b.id - a.id),
      assignees,
    };
  }

  listUsers(): Promise<StoredUser[]> {
    return getAllUsers();
  }

  async getUserIcon(userId: number): Promise<Blob | undefined> {
    const icon = await getUserIcon(userId);
    return icon?.blob;
  }

  async getProjectIcon(projectId: number): Promise<Blob | undefined> {
    const icon = await getProjectIcon(projectId);
    return icon?.blob;
  }

  getIssueByKeyId(
    projectId: number,
    keyId: number,
  ): Promise<StoredIssue | undefined> {
    return getIssueByKeyId(projectId, keyId);
  }

  getChildIssues(
    projectId: number,
    parentIssueId: number,
  ): Promise<StoredIssue[]> {
    return getChildIssues(projectId, parentIssueId);
  }

  async getIssueById(
    projectId: number,
    issueId: number,
  ): Promise<StoredIssue | undefined> {
    const issue = await getIssueById(issueId);
    // パーティション越境を防ぐ: projectId が一致しないものは返さない
    return issue && issue.projectId === projectId ? issue : undefined;
  }

  async listComments(
    projectId: number,
    issueId: number,
  ): Promise<StoredComment[]> {
    const comments = await getCommentsByIssue(issueId);
    // created 昇順（スレッド順）
    return comments
      .filter((c) => c.projectId === projectId)
      .sort((a, b) => a.created.localeCompare(b.created));
  }

  async listAttachments(
    projectId: number,
    issueId: number,
  ): Promise<AttachmentMeta[]> {
    const atts = await getAttachmentsByIssue(issueId);
    return atts.filter((a) => a.projectId === projectId);
  }

  listWikis(query: WikiListQuery): Promise<WikiListPage> {
    return queryWikis({
      projectId: query.projectId,
      offset: query.offset,
      limit: query.limit,
      sort: query.sort ?? "updated",
      order: query.order ?? "desc",
    });
  }

  listWikiHeadings(projectId: number): Promise<WikiHeading[]> {
    return getWikiHeadingsByProject(projectId);
  }

  async getWikiById(
    projectId: number,
    wikiId: number,
  ): Promise<StoredWiki | undefined> {
    const wiki = await getWikiById(wikiId);
    // パーティション越境を防ぐ: projectId が一致しないものは返さない
    return wiki && wiki.projectId === projectId ? wiki : undefined;
  }

  getWikiByName(
    projectId: number,
    name: string,
  ): Promise<StoredWiki | undefined> {
    // getWikiByName は projectId で絞ってから name 一致を探すので越境の心配はない
    return getWikiByName(projectId, name);
  }

  async listDocuments(projectId: number): Promise<StoredDocument[]> {
    const docs = await getDocumentsByProject(projectId);
    // updated 降順
    return docs.sort((a, b) => b.updated.localeCompare(a.updated));
  }

  async getDocumentById(
    projectId: number,
    documentId: string,
  ): Promise<StoredDocument | undefined> {
    const doc = await getDocumentById(documentId);
    return doc && doc.projectId === projectId ? doc : undefined;
  }

  search(
    projectId: number,
    query: string,
    limit?: number,
    kinds?: SearchKind[],
  ): Promise<SearchHit[]> {
    return searchProject(projectId, query, limit, kinds);
  }

  async hasData(projectId: number): Promise<boolean> {
    const count = await countIssuesByProject(projectId);
    return count > 0;
  }
}
