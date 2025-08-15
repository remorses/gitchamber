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

interface FormatFileOptions {
  content: string;
  showLineNumbers?: boolean;
  startLine?: number;
  endLine?: number;
  maxLines?: number;
}

export function formatFileWithLines(options: FormatFileOptions): string {
  const { content: contents, showLineNumbers = false, startLine, endLine, maxLines = 1000 } = options;
  const lines = contents.split("\n");

  // Apply max lines limit if no specific range is provided
  let effectiveEndLine = endLine;
  if (startLine === undefined && endLine === undefined && lines.length > maxLines) {
    effectiveEndLine = maxLines;
  }

  // Filter lines by range if specified
  const filteredLines = (() => {
    if (startLine !== undefined || effectiveEndLine !== undefined) {
      const start = startLine ? Math.max(0, startLine - 1) : 0; // Convert to 0-based index, ensure non-negative
      const end = effectiveEndLine ? Math.min(effectiveEndLine, lines.length) : lines.length; // Don't exceed file length
      return lines.slice(start, end);
    }
    return lines;
  })();

  // Check if content is truncated
  const actualStart = startLine ? Math.max(0, startLine - 1) : 0;
  const actualEnd = effectiveEndLine ? Math.min(effectiveEndLine, lines.length) : lines.length;
  const hasContentAbove = actualStart > 0;
  const hasContentBelow = actualEnd < lines.length;

  // Calculate lines remaining if truncated
  const linesRemaining = hasContentBelow ? lines.length - actualEnd : 0;

  // Show line numbers if requested or if line ranges are specified
  const shouldShowLineNumbers =
    showLineNumbers || startLine !== undefined || effectiveEndLine !== undefined;

  // Add line numbers if requested
  if (shouldShowLineNumbers) {
    const startLineNumber = startLine || 1;
    const maxLineNumber = startLineNumber + filteredLines.length - 1;
    const padding = maxLineNumber.toString().length;

    const formattedLines = filteredLines.map((line, index) => {
      const lineNumber = startLineNumber + index;
      const paddedNumber = lineNumber.toString().padStart(padding, " ");
      return `${paddedNumber}  ${line}`;
    });

    // Add end of file indicator or lines remaining
    const result: string[] = [];
    result.push(...formattedLines);
    if (!hasContentBelow) {
      result.push("end of file");
    } else if (linesRemaining > 0) {
      result.push(`[File truncated: ${linesRemaining} more lines]`);
    }

    return result.join("\n");
  }

  // For non-line-numbered output, also add end of file indicator or lines remaining
  const result: string[] = [];
  result.push(...filteredLines);
  if (!hasContentBelow && filteredLines.length > 0) {
    // Don't add "end of file" for raw content unless explicitly truncated
  } else if (linesRemaining > 0) {
    result.push(`\n[File truncated: ${linesRemaining} more lines]`);
  }

  return result.join("\n");
}

export function extractSnippetFromContent(
  content: string,
  searchQuery: string,
  maxLength: number = 200
): string {
  if (!content || !searchQuery) {
    return "";
  }

  // Case-insensitive search
  const lowerContent = content.toLowerCase();
  const lowerQuery = searchQuery.toLowerCase();
  const index = lowerContent.indexOf(lowerQuery);

  if (index === -1) {
    // If not found in content, might be in the path - return first part of content
    const lines = content.split('\n').slice(0, 3).join('\n');
    if (lines.length > maxLength) {
      return lines.substring(0, maxLength) + '...';
    }
    return lines;
  }

  // Extract context around the match
  const contextRadius = Math.floor((maxLength - searchQuery.length) / 2);
  const start = Math.max(0, index - contextRadius);
  const end = Math.min(content.length, index + searchQuery.length + contextRadius);

  let snippet = content.substring(start, end);

  // Add ellipsis if truncated
  if (start > 0) {
    snippet = '...' + snippet;
  }
  if (end < content.length) {
    snippet = snippet + '...';
  }

  // Clean up: try to break at word boundaries
  if (start > 0) {
    const firstSpace = snippet.indexOf(' ', 3);
    if (firstSpace > 3 && firstSpace < 20) {
      snippet = '...' + snippet.substring(firstSpace + 1);
    }
  }
  if (end < content.length) {
    const lastSpace = snippet.lastIndexOf(' ', snippet.length - 4);
    if (lastSpace > snippet.length - 20) {
      snippet = snippet.substring(0, lastSpace) + '...';
    }
  }

  return snippet;
}