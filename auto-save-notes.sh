#!/bin/bash
# Auto-update CLAUDE_NOTES.md with timestamp

NOTES_FILE="/Users/sshanoor/ClaudeProjects/Whiskie/CLAUDE_NOTES.md"

# Add timestamp to notes
echo "" >> "$NOTES_FILE"
echo "---" >> "$NOTES_FILE"
echo "**Last Auto-Update:** $(date)" >> "$NOTES_FILE"
echo "" >> "$NOTES_FILE"

# Backup notes periodically
BACKUP_DIR="/Users/sshanoor/ClaudeProjects/Whiskie/backups"
mkdir -p "$BACKUP_DIR"
cp "$NOTES_FILE" "$BACKUP_DIR/CLAUDE_NOTES_$(date +%Y%m%d_%H%M%S).md"

echo "Notes updated and backed up"
