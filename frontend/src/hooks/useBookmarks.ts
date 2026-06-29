import { useState, useCallback } from "react";
import { getJson, setJson } from "../utils/storage";

const BOOKMARKS_KEY = "***";

type BookmarkMap = Record<string, string[]>; // quizId -> questionId[]

function loadBookmarks(): BookmarkMap {
  return getJson<BookmarkMap>(BOOKMARKS_KEY, {});
}

function saveBookmarks(map: BookmarkMap) {
  setJson(BOOKMARKS_KEY, map);
}

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<BookmarkMap>(loadBookmarks);

  const toggleBookmark = useCallback((quizId: string, questionId: string) => {
    setBookmarks((prev) => {
      const map = { ...prev };
      const ids = [...(map[quizId] ?? [])];
      const idx = ids.indexOf(questionId);
      if (idx >= 0) {
        ids.splice(idx, 1);
      } else {
        ids.push(questionId);
      }
      map[quizId] = ids;
      saveBookmarks(map);
      return map;
    });
  }, []);

  const isBookmarked = useCallback(
    (quizId: string, questionId: string): boolean => {
      return (bookmarks[quizId] ?? []).includes(questionId);
    },
    [bookmarks],
  );

  const getBookmarks = useCallback(
    (quizId: string): string[] => {
      return bookmarks[quizId] ?? [];
    },
    [bookmarks],
  );

  return { toggleBookmark, isBookmarked, getBookmarks };
}
