#!/bin/bash
# ralph-loop.sh - Iterative AI build loop for stock-picker-madness

set -e

ITERATIONS=${1:-5}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPEC_FILE="$SCRIPT_DIR/planning/project-spec.md"
PROGRESS_FILE="$SCRIPT_DIR/planning/progress.txt"
PROMPT_FILE="$SCRIPT_DIR/planning/prompt.txt"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Ralph Loop: stock-picker-madness ===${NC}"
echo "Running $ITERATIONS iteration(s)"
echo ""

# Check required files exist
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
        echo -e "${GREEN}=== PROJECT COMPLETE ===${NC}"
        echo "The MVP is finished! Check planning/progress.txt for details."
        # macOS notification if available
        if command -v osascript &> /dev/null; then
            osascript -e 'display notification "stock-picker-madness MVP is complete!" with title "Ralph Loop"'
        fi
        exit 0
    fi
    
    if grep -q "<promise>BLOCKED</promise>" "$PROGRESS_FILE" 2>/dev/null; then
        echo -e "${RED}=== BUILD BLOCKED ===${NC}"
        echo "The AI is stuck and needs human input."
        echo ""
        echo "Check planning/progress.txt for the blocking reason."
        echo "After resolving, remove the <promise>BLOCKED</promise> line and run again."
        # macOS notification if available
        if command -v osascript &> /dev/null; then
            osascript -e 'display notification "stock-picker-madness build is BLOCKED" with title "Ralph Loop"'
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
    opencode run \
        -f "$SPEC_FILE" \
        -f "$PROGRESS_FILE" \
        -f "$PROMPT_FILE" \
        -- "Continue building stock-picker-madness. Read the context files, identify the next step, implement it, verify it works, commit, and update progress.txt."
    
    echo ""
    
    # Check signals after each iteration
    check_signals
    
    echo -e "${GREEN}Iteration $i complete${NC}"
    echo ""
done

echo -e "${YELLOW}=== Completed $ITERATIONS iterations ===${NC}"
echo ""
echo "Progress so far is logged in planning/progress.txt"
echo ""
echo "To continue building, run: ./ralph-loop.sh <more-iterations>"
