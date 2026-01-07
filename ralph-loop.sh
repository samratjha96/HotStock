#!/bin/bash
# ralph-loop.sh - Iterative AI build loop for HotStock
# Supports feature-based development: ./ralph-loop.sh <feature_name> <iterations>

set -e

FEATURE=${1:-project-start}
ITERATIONS=${2:-5}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Determine file paths based on feature
if [ "$FEATURE" = "project-start" ]; then
    # Legacy support for original project setup
    FEATURE_DIR="$SCRIPT_DIR/planning"
    SPEC_FILE="$FEATURE_DIR/project-spec.md"
    PROGRESS_FILE="$FEATURE_DIR/progress.txt"
    PROMPT_FILE="$FEATURE_DIR/prompt.txt"
else
    # New feature-based structure
    FEATURE_DIR="$SCRIPT_DIR/planning/ralph/$FEATURE"
    SPEC_FILE="$FEATURE_DIR/spec.md"
    PROGRESS_FILE="$FEATURE_DIR/progress.txt"
    PROMPT_FILE="$FEATURE_DIR/prompt.txt"
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Ralph Loop: HotStock ($FEATURE) ===${NC}"
echo "Running $ITERATIONS iteration(s)"
echo "Feature directory: $FEATURE_DIR"
echo ""

# Check required files exist
if [ ! -d "$FEATURE_DIR" ]; then
    echo -e "${RED}ERROR: Feature directory not found at $FEATURE_DIR${NC}"
    echo "Available features:"
    ls -1 "$SCRIPT_DIR/planning/ralph/" 2>/dev/null || echo "  (none)"
    exit 1
fi

if [ ! -f "$SPEC_FILE" ]; then
    echo -e "${RED}ERROR: Spec file not found at $SPEC_FILE${NC}"
    exit 1
fi

if [ ! -f "$PROMPT_FILE" ]; then
    echo -e "${RED}ERROR: Prompt file not found at $PROMPT_FILE${NC}"
    exit 1
fi

if [ ! -f "$PROGRESS_FILE" ]; then
    echo -e "${RED}ERROR: Progress file not found at $PROGRESS_FILE${NC}"
    exit 1
fi

# Function to check for completion/blocked signals
check_signals() {
    if grep -q "<promise>COMPLETE</promise>" "$PROGRESS_FILE" 2>/dev/null; then
        echo -e "${GREEN}=== FEATURE COMPLETE ===${NC}"
        echo "The $FEATURE feature is finished! Check $PROGRESS_FILE for details."
        # macOS notification if available
        if command -v osascript &> /dev/null; then
            osascript -e "display notification \"HotStock $FEATURE is complete!\" with title \"Ralph Loop\""
        fi
        exit 0
    fi
    
    if grep -q "<promise>BLOCKED</promise>" "$PROGRESS_FILE" 2>/dev/null; then
        echo -e "${RED}=== BUILD BLOCKED ===${NC}"
        echo "The AI is stuck and needs human input."
        echo ""
        echo "Check $PROGRESS_FILE for the blocking reason."
        echo "After resolving, remove the <promise>BLOCKED</promise> line and run again."
        # macOS notification if available
        if command -v osascript &> /dev/null; then
            osascript -e "display notification \"HotStock $FEATURE build is BLOCKED\" with title \"Ralph Loop\""
        fi
        exit 1
    fi
}

# Check signals before starting
check_signals

for i in $(seq 1 $ITERATIONS); do
    echo -e "${YELLOW}--- Iteration $i of $ITERATIONS ---${NC}"
    echo ""
    
    # Run opencode with context files
    # Pass iteration info via environment or in the message
    opencode run \
        -f "$SPEC_FILE" \
        -f "$PROGRESS_FILE" \
        -f "$PROMPT_FILE" \
        -- "Iteration $i of $ITERATIONS. Continue working on HotStock feature: $FEATURE. Read the context files, identify the next step, implement it, verify it works, commit, and update progress.txt."
    
    echo ""
    
    # Check signals after each iteration
    check_signals
    
    echo -e "${GREEN}Iteration $i complete${NC}"
    echo ""
done

echo -e "${YELLOW}=== Completed $ITERATIONS iterations ===${NC}"
echo ""
echo "Progress so far is logged in $PROGRESS_FILE"
echo ""
echo "To continue building, run: ./ralph-loop.sh $FEATURE <more-iterations>"
