export function findLineNumberInContent(
  content: string,
  searchSnippet: string,
): number | null {
  try {
    if (!content || !searchSnippet) {
      return null;
    }

    // Clean the snippet by removing leading/trailing whitespace
    const cleanSnippet = searchSnippet.trim();

    // If snippet is too short, return null
    if (cleanSnippet.length < 3) {
      return null;
    }

    // Try exact match first
    let index = content.indexOf(cleanSnippet);

    if (index === -1) {
      // Try to find a substring that's more likely to match
      // Split snippet into words and find the longest matching sequence
      const words = cleanSnippet.split(/\s+/).filter((word) => word.length > 2);

      for (const word of words) {
        const wordIndex = content.indexOf(word);
        if (wordIndex !== -1) {
          index = wordIndex;
          break;
        }
      }
    }

    if (index === -1) {
      return null;
    }

    // Count newlines before the found index to determine line number
    const beforeMatch = content.substring(0, index);
    const lineNumber = beforeMatch.split("\n").length;

    return lineNumber;
  } catch (e) {
    console.error("Error finding line number:", e);
    return null;
  }
}