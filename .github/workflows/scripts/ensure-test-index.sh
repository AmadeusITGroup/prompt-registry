#!/bin/bash
echo "Ensuring test index file exists..."

# Ensure test-dist/test directory exists
mkdir -p test-dist/test

# Check if index.js exists, if not create a basic one
if [ ! -f "test-dist/test/index.js" ]; then
    echo "Creating basic test index.js..."
    cat > test-dist/test/index.js << 'INDEX_EOF'
const path = require('path');
const { glob } = require('glob');

exports.run = function() {
  // Create the mocha test
  const Mocha = require('mocha');
  const mocha = new Mocha({
    ui: 'bdd',
    color: true
  });

  const testsRoot = path.resolve(__dirname, '.');

  return (async () => {
    return new Promise((c, e) => {
      (async () => {
        try {
          const files = await glob('**/**.test.js', { cwd: testsRoot });
          
          // Add files to the test suite
          files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

          // Run the mocha test
          mocha.run((failures) => {
            if (failures > 0) {
              e(new Error(`${failures} tests failed.`));
            } else {
              c();
            }
          });
        } catch (err) {
          console.error(err);
          e(err);
        }
      })();
    });
  })();
}
INDEX_EOF
else
    echo "Test index.js already exists"
fi

echo "Test index file check completed"
