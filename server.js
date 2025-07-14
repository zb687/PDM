const express = require('express');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    const allowedTypes = /xlsx|xls|csv/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || 
                    file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                    file.mimetype === 'application/vnd.ms-excel' ||
                    file.mimetype === 'text/csv';
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only Excel and CSV files are allowed'));
    }
  }
});

// JSON file-based database
const DB_FILE = './products.json';
const COLUMNS_FILE = './columns.json';

// Core column definitions
const coreColumns = {
  item: 'TEXT PRIMARY KEY',
  description: 'TEXT',
  grp_sect: 'TEXT',
  onhand: 'REAL',
  um: 'TEXT',
  committed: 'REAL',
  onorder: 'REAL',
  unit_price: 'REAL',
  um2: 'TEXT'
};

// Initialize database files
function initializeDatabase() {
  // Initialize products file
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2));
  }
  
  // Initialize columns file
  if (!fs.existsSync(COLUMNS_FILE)) {
    fs.writeFileSync(COLUMNS_FILE, JSON.stringify({}, null, 2));
  }
  
  console.log('Database initialized.');
}

// Read data from JSON files
function readProducts() {
  try {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading products:', error);
    return [];
  }
}

function writeProducts(products) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(products, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing products:', error);
    return false;
  }
}

function readColumns() {
  try {
    const data = fs.readFileSync(COLUMNS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading columns:', error);
    return {};
  }
}

function writeColumns(columns) {
  try {
    fs.writeFileSync(COLUMNS_FILE, JSON.stringify(columns, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing columns:', error);
    return false;
  }
}

// Dynamic columns storage
let dynamicColumns = {};

function loadDynamicColumns() {
  dynamicColumns = readColumns();
  console.log('Loaded dynamic columns:', dynamicColumns);
}

// Add new column
function addColumn(columnName, columnType = 'TEXT') {
  const sanitizedName = columnName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  
  if (coreColumns[sanitizedName] || dynamicColumns[sanitizedName]) {
    return false; // Column already exists
  }

  try {
    dynamicColumns[sanitizedName] = columnType;
    writeColumns(dynamicColumns);
    return true;
  } catch (error) {
    console.error('Error adding column:', error);
    throw error;
  }
}

// Get all columns (core + dynamic)
function getAllColumns() {
  return { ...coreColumns, ...dynamicColumns };
}

// Initialize database
initializeDatabase();
loadDynamicColumns();

// Routes

// Get all products
app.get('/api/products', (req, res) => {
  try {
    const products = readProducts();
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single product
app.get('/api/products/:item', (req, res) => {
  try {
    const products = readProducts();
    const product = products.find(p => p.item === req.params.item);
    
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create or update product
app.post('/api/products', (req, res) => {
  const data = req.body;
  
  // Validate required fields
  if (!data.item) {
    res.status(400).json({ error: 'Item code is required' });
    return;
  }

  try {
    const products = readProducts();
    const existingIndex = products.findIndex(p => p.item === data.item);
    
    // Add timestamps
    const now = new Date().toISOString();
    data.updated_at = now;
    if (existingIndex === -1) {
      data.created_at = now;
    }
    
    if (existingIndex >= 0) {
      // Update existing product
      products[existingIndex] = { ...products[existingIndex], ...data };
    } else {
      // Add new product
      products.push(data);
    }
    
    writeProducts(products);
    
    res.json({ 
      message: existingIndex >= 0 ? 'Product updated successfully' : 'Product created successfully',
      item: data.item 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete product
app.delete('/api/products/:item', (req, res) => {
  try {
    const products = readProducts();
    const initialLength = products.length;
    const filteredProducts = products.filter(p => p.item !== req.params.item);
    
    if (filteredProducts.length === initialLength) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    
    writeProducts(filteredProducts);
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get column definitions
app.get('/api/columns', (req, res) => {
  res.json({
    core: coreColumns,
    dynamic: dynamicColumns,
    all: getAllColumns()
  });
});

// Add new column
app.post('/api/columns', (req, res) => {
  const { columnName, columnType = 'TEXT' } = req.body;
  
  if (!columnName) {
    res.status(400).json({ error: 'Column name is required' });
    return;
  }

  try {
    const added = addColumn(columnName, columnType);
    if (added) {
      res.json({ 
        message: 'Column added successfully',
        columnName: columnName.toLowerCase().replace(/[^a-z0-9_]/g, '_')
      });
    } else {
      res.status(400).json({ error: 'Column already exists' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Import from Excel/CSV file
app.post('/api/import/file', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  try {
    let data;
    const filePath = req.file.path;
    const fileExtension = path.extname(req.file.originalname).toLowerCase();

    if (fileExtension === '.csv') {
      // Handle CSV files
      const workbook = xlsx.readFile(filePath, { type: 'file' });
      const sheetName = workbook.SheetNames[0];
      data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    } else {
      // Handle Excel files
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    }

    if (!data || data.length === 0) {
      res.status(400).json({ error: 'No data found in file' });
      return;
    }

    // Analyze columns and add new ones if needed
    const sampleRow = data[0];
    const fileColumns = Object.keys(sampleRow);
    const newColumnsAdded = [];

    for (const col of fileColumns) {
      const sanitizedCol = col.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const allColumns = getAllColumns();
      
      if (!allColumns[sanitizedCol] && sanitizedCol !== 'item') {
        try {
          const added = addColumn(col);
          if (added) {
            newColumnsAdded.push(sanitizedCol);
          }
        } catch (error) {
          console.error(`Error adding column ${col}:`, error);
        }
      }
    }

    // Import data
    let imported = 0;
    let errors = [];
    const products = readProducts();

    for (const row of data) {
      try {
        // Map file column names to database column names
        const mappedRow = {};
        Object.keys(row).forEach(key => {
          const sanitizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
          mappedRow[sanitizedKey] = row[key];
        });

        if (!mappedRow.item) {
          errors.push(`Row missing item code: ${JSON.stringify(row)}`);
          continue;
        }

        // Add timestamps
        const now = new Date().toISOString();
        mappedRow.updated_at = now;
        
        const existingIndex = products.findIndex(p => p.item === mappedRow.item);
        if (existingIndex >= 0) {
          products[existingIndex] = { ...products[existingIndex], ...mappedRow };
        } else {
          mappedRow.created_at = now;
          products.push(mappedRow);
        }
        
        imported++;
      } catch (error) {
        errors.push(`Error importing row: ${error.message}`);
      }
    }

    writeProducts(products);

    // Clean up uploaded file
    fs.unlinkSync(filePath);

    res.json({
      message: 'Import completed',
      imported,
      errors: errors.length > 0 ? errors : undefined,
      newColumnsAdded
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Import from paste data
app.post('/api/import/paste', (req, res) => {
  const { data, delimiter = '\t' } = req.body;
  
  if (!data) {
    res.status(400).json({ error: 'No data provided' });
    return;
  }

  try {
    const lines = data.trim().split('\n');
    if (lines.length === 0) {
      res.status(400).json({ error: 'No data lines found' });
      return;
    }

    // Parse first line to determine if it's headers or data
    const firstLine = lines[0].split(delimiter);
    const isFirstLineHeader = firstLine.some(cell => 
      isNaN(parseFloat(cell)) && !cell.match(/^\$?\d+\.?\d*$/)
    );

    let headers;
    let dataLines;

    if (isFirstLineHeader) {
      headers = firstLine.map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
      dataLines = lines.slice(1);
    } else {
      // Use default column order from your original spec
      headers = ['item', 'description', 'grp_sect', 'onhand', 'um', 'committed', 'onorder', 'unit_price', 'um2'];
      dataLines = lines;
    }

    // Add new columns if needed
    const newColumnsAdded = [];
    for (const header of headers) {
      const allColumns = getAllColumns();
      if (!allColumns[header] && header !== 'item') {
        try {
          const added = addColumn(header);
          if (added) {
            newColumnsAdded.push(header);
          }
        } catch (error) {
          console.error(`Error adding column ${header}:`, error);
        }
      }
    }

    let imported = 0;
    let errors = [];
    const products = readProducts();

    for (const line of dataLines) {
      try {
        const values = line.split(delimiter).map(v => v.trim());
        if (values.length === 0 || !values[0]) continue;

        const rowData = {};
        headers.forEach((header, index) => {
          if (values[index] !== undefined) {
            let value = values[index];
            
            // Clean up currency values
            if (value.startsWith('
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    const allowedTypes = /xlsx|xls|csv/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || 
                    file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                    file.mimetype === 'application/vnd.ms-excel' ||
                    file.mimetype === 'text/csv';
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only Excel and CSV files are allowed'));
    }
  }
});

// Initialize better-sqlite3 database
const db = new Database('./products.db');
console.log('Connected to SQLite database.');

// Core column definitions
const coreColumns = {
  item: 'TEXT PRIMARY KEY',
  description: 'TEXT',
  grp_sect: 'TEXT',
  onhand: 'REAL',
  um: 'TEXT',
  committed: 'REAL',
  onorder: 'REAL',
  unit_price: 'REAL',
  um2: 'TEXT'
};

// Dynamic columns storage
let dynamicColumns = {};

function initializeDatabase() {
  // Create core products table
  const coreColumnsStr = Object.entries(coreColumns)
    .map(([name, type]) => `${name} ${type}`)
    .join(', ');
  
  db.exec(`CREATE TABLE IF NOT EXISTS products (
    ${coreColumnsStr},
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Create table to track dynamic columns
  db.exec(`CREATE TABLE IF NOT EXISTS column_definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    column_name TEXT UNIQUE,
    column_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Load existing dynamic columns
  loadDynamicColumns();
}

function loadDynamicColumns() {
  try {
    const rows = db.prepare("SELECT column_name, column_type FROM column_definitions").all();
    rows.forEach(row => {
      dynamicColumns[row.column_name] = row.column_type;
    });
    console.log('Loaded dynamic columns:', dynamicColumns);
  } catch (error) {
    console.error('Error loading dynamic columns:', error);
  }
}

// Add new column to database
function addColumn(columnName, columnType = 'TEXT') {
  const sanitizedName = columnName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  
  if (coreColumns[sanitizedName] || dynamicColumns[sanitizedName]) {
    return false; // Column already exists
  }

  try {
    db.exec(`ALTER TABLE products ADD COLUMN ${sanitizedName} ${columnType}`);
    
    // Save column definition
    const stmt = db.prepare("INSERT INTO column_definitions (column_name, column_type) VALUES (?, ?)");
    stmt.run(sanitizedName, columnType);
    
    dynamicColumns[sanitizedName] = columnType;
    return true;
  } catch (error) {
    console.error('Error adding column:', error);
    throw error;
  }
}

// Get all columns (core + dynamic)
function getAllColumns() {
  return { ...coreColumns, ...dynamicColumns };
}

// Initialize database
initializeDatabase();

// Routes

// Get all products
app.get('/api/products', (req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM products ORDER BY item").all();
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single product
app.get('/api/products/:item', (req, res) => {
  try {
    const row = db.prepare("SELECT * FROM products WHERE item = ?").get(req.params.item);
    if (!row) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json(row);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create or update product
app.post('/api/products', (req, res) => {
  const data = req.body;
  const allColumns = getAllColumns();
  
  // Validate required fields
  if (!data.item) {
    res.status(400).json({ error: 'Item code is required' });
    return;
  }

  try {
    // Prepare columns and values for insert/update
    const columns = Object.keys(data).filter(key => 
      allColumns[key] !== undefined || key === 'item'
    );
    
    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map(col => data[col]);
    
    // Use INSERT OR REPLACE for upsert functionality
    const query = `INSERT OR REPLACE INTO products (${columns.join(', ')}, updated_at) 
                   VALUES (${placeholders}, CURRENT_TIMESTAMP)`;
    
    const stmt = db.prepare(query);
    const result = stmt.run(...values);
    
    res.json({ 
      message: result.changes > 0 ? 'Product saved successfully' : 'Product created successfully',
      item: data.item 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete product
app.delete('/api/products/:item', (req, res) => {
  try {
    const stmt = db.prepare("DELETE FROM products WHERE item = ?");
    const result = stmt.run(req.params.item);
    
    if (result.changes === 0) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get column definitions
app.get('/api/columns', (req, res) => {
  res.json({
    core: coreColumns,
    dynamic: dynamicColumns,
    all: getAllColumns()
  });
});

// Add new column
app.post('/api/columns', (req, res) => {
  const { columnName, columnType = 'TEXT' } = req.body;
  
  if (!columnName) {
    res.status(400).json({ error: 'Column name is required' });
    return;
  }

  try {
    const added = addColumn(columnName, columnType);
    if (added) {
      res.json({ 
        message: 'Column added successfully',
        columnName: columnName.toLowerCase().replace(/[^a-z0-9_]/g, '_')
      });
    } else {
      res.status(400).json({ error: 'Column already exists' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Import from Excel/CSV file
app.post('/api/import/file', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  try {
    let data;
    const filePath = req.file.path;
    const fileExtension = path.extname(req.file.originalname).toLowerCase();

    if (fileExtension === '.csv') {
      // Handle CSV files
      const workbook = xlsx.readFile(filePath, { type: 'file' });
      const sheetName = workbook.SheetNames[0];
      data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    } else {
      // Handle Excel files
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    }

    if (!data || data.length === 0) {
      res.status(400).json({ error: 'No data found in file' });
      return;
    }

    // Analyze columns and add new ones if needed
    const sampleRow = data[0];
    const fileColumns = Object.keys(sampleRow);
    const newColumnsAdded = [];

    for (const col of fileColumns) {
      const sanitizedCol = col.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const allColumns = getAllColumns();
      
      if (!allColumns[sanitizedCol] && sanitizedCol !== 'item') {
        try {
          const added = addColumn(col);
          if (added) {
            newColumnsAdded.push(sanitizedCol);
          }
        } catch (error) {
          console.error(`Error adding column ${col}:`, error);
        }
      }
    }

    // Import data
    let imported = 0;
    let errors = [];

    const insertStmt = db.prepare(`INSERT OR REPLACE INTO products VALUES (${'?, '.repeat(Object.keys(getAllColumns()).length + 2).slice(0, -2)})`);

    for (const row of data) {
      try {
        // Map file column names to database column names
        const mappedRow = {};
        Object.keys(row).forEach(key => {
          const sanitizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
          mappedRow[sanitizedKey] = row[key];
        });

        if (!mappedRow.item) {
          errors.push(`Row missing item code: ${JSON.stringify(row)}`);
          continue;
        }

        const allColumns = getAllColumns();
        const columns = Object.keys(mappedRow).filter(key => 
          allColumns[key] !== undefined
        );
        
        const values = columns.map(col => mappedRow[col]);
        values.push(new Date().toISOString()); // created_at
        values.push(new Date().toISOString()); // updated_at
        
        const query = `INSERT OR REPLACE INTO products (${columns.join(', ')}, created_at, updated_at) 
                       VALUES (${'?, '.repeat(values.length).slice(0, -2)})`;
        
        const stmt = db.prepare(query);
        stmt.run(...values);
        
        imported++;
      } catch (error) {
        errors.push(`Error importing row: ${error.message}`);
      }
    }

    // Clean up uploaded file
    require('fs').unlinkSync(filePath);

    res.json({
      message: 'Import completed',
      imported,
      errors: errors.length > 0 ? errors : undefined,
      newColumnsAdded
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Import from paste data
app.post('/api/import/paste', (req, res) => {
  const { data, delimiter = '\t' } = req.body;
  
  if (!data) {
    res.status(400).json({ error: 'No data provided' });
    return;
  }

  try {
    const lines = data.trim().split('\n');
    if (lines.length === 0) {
      res.status(400).json({ error: 'No data lines found' });
      return;
    }

    // Parse first line to determine if it's headers or data
    const firstLine = lines[0].split(delimiter);
    const isFirstLineHeader = firstLine.some(cell => 
      isNaN(parseFloat(cell)) && !cell.match(/^\$?\d+\.?\d*$/)
    );

    let headers;
    let dataLines;

    if (isFirstLineHeader) {
      headers = firstLine.map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
      dataLines = lines.slice(1);
    } else {
      // Use default column order from your original spec
      headers = ['item', 'description', 'grp_sect', 'onhand', 'um', 'committed', 'onorder', 'unit_price', 'um2'];
      dataLines = lines;
    }

    // Add new columns if needed
    const newColumnsAdded = [];
    for (const header of headers) {
      const allColumns = getAllColumns();
      if (!allColumns[header] && header !== 'item') {
        try {
          const added = addColumn(header);
          if (added) {
            newColumnsAdded.push(header);
          }
        } catch (error) {
          console.error(`Error adding column ${header}:`, error);
        }
      }
    }

    let imported = 0;
    let errors = [];

    for (const line of dataLines) {
      try {
        const values = line.split(delimiter).map(v => v.trim());
        if (values.length === 0 || !values[0]) continue;

        const rowData = {};
        headers.forEach((header, index) => {
          if (values[index] !== undefined) {
            let value = values[index];
            
            // Clean up currency values
            if (value.startsWith('

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    const allowedTypes = /xlsx|xls|csv/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || 
                    file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                    file.mimetype === 'application/vnd.ms-excel' ||
                    file.mimetype === 'text/csv';
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only Excel and CSV files are allowed'));
    }
  }
});

// Initialize SQLite database
const db = new sqlite3.Database('./products.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    initializeDatabase();
  }
});

// Core column definitions
const coreColumns = {
  item: 'TEXT PRIMARY KEY',
  description: 'TEXT',
  grp_sect: 'TEXT',
  onhand: 'REAL',
  um: 'TEXT',
  committed: 'REAL',
  onorder: 'REAL',
  unit_price: 'REAL',
  um2: 'TEXT'
};

// Dynamic columns storage
let dynamicColumns = {};

function initializeDatabase() {
  // Create core products table
  const coreColumnsStr = Object.entries(coreColumns)
    .map(([name, type]) => `${name} ${type}`)
    .join(', ');
  
  db.run(`CREATE TABLE IF NOT EXISTS products (
    ${coreColumnsStr},
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Create table to track dynamic columns
  db.run(`CREATE TABLE IF NOT EXISTS column_definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    column_name TEXT UNIQUE,
    column_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Load existing dynamic columns
  loadDynamicColumns();
}

function loadDynamicColumns() {
  db.all("SELECT column_name, column_type FROM column_definitions", (err, rows) => {
    if (err) {
      console.error('Error loading dynamic columns:', err);
      return;
    }
    
    rows.forEach(row => {
      dynamicColumns[row.column_name] = row.column_type;
    });
    
    console.log('Loaded dynamic columns:', dynamicColumns);
  });
}

// Add new column to database
function addColumn(columnName, columnType = 'TEXT') {
  return new Promise((resolve, reject) => {
    const sanitizedName = columnName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    
    if (coreColumns[sanitizedName] || dynamicColumns[sanitizedName]) {
      resolve(false); // Column already exists
      return;
    }

    db.run(`ALTER TABLE products ADD COLUMN ${sanitizedName} ${columnType}`, (err) => {
      if (err) {
        console.error('Error adding column:', err);
        reject(err);
        return;
      }

      // Save column definition
      db.run("INSERT INTO column_definitions (column_name, column_type) VALUES (?, ?)", 
        [sanitizedName, columnType], (err) => {
        if (err) {
          console.error('Error saving column definition:', err);
          reject(err);
          return;
        }

        dynamicColumns[sanitizedName] = columnType;
        resolve(true);
      });
    });
  });
}

// Get all columns (core + dynamic)
function getAllColumns() {
  return { ...coreColumns, ...dynamicColumns };
}

// Routes

// Get all products
app.get('/api/products', (req, res) => {
  db.all("SELECT * FROM products ORDER BY item", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Get single product
app.get('/api/products/:item', (req, res) => {
  db.get("SELECT * FROM products WHERE item = ?", [req.params.item], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json(row);
  });
});

// Create or update product
app.post('/api/products', (req, res) => {
  const data = req.body;
  const allColumns = getAllColumns();
  
  // Validate required fields
  if (!data.item) {
    res.status(400).json({ error: 'Item code is required' });
    return;
  }

  // Prepare columns and values for insert/update
  const columns = Object.keys(data).filter(key => 
    allColumns[key] !== undefined || key === 'item'
  );
  
  const placeholders = columns.map(() => '?').join(', ');
  const values = columns.map(col => data[col]);
  
  const updatePlaceholders = columns
    .filter(col => col !== 'item')
    .map(col => `${col} = ?`)
    .join(', ');
  
  const updateValues = columns
    .filter(col => col !== 'item')
    .map(col => data[col]);

  // Use INSERT OR REPLACE for upsert functionality
  const query = `INSERT OR REPLACE INTO products (${columns.join(', ')}, updated_at) 
                 VALUES (${placeholders}, CURRENT_TIMESTAMP)`;
  
  db.run(query, values, function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ 
      message: this.changes > 0 ? 'Product saved successfully' : 'Product created successfully',
      item: data.item 
    });
  });
});

// Delete product
app.delete('/api/products/:item', (req, res) => {
  db.run("DELETE FROM products WHERE item = ?", [req.params.item], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (this.changes === 0) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json({ message: 'Product deleted successfully' });
  });
});

// Get column definitions
app.get('/api/columns', (req, res) => {
  res.json({
    core: coreColumns,
    dynamic: dynamicColumns,
    all: getAllColumns()
  });
});

// Add new column
app.post('/api/columns', async (req, res) => {
  const { columnName, columnType = 'TEXT' } = req.body;
  
  if (!columnName) {
    res.status(400).json({ error: 'Column name is required' });
    return;
  }

  try {
    const added = await addColumn(columnName, columnType);
    if (added) {
      res.json({ 
        message: 'Column added successfully',
        columnName: columnName.toLowerCase().replace(/[^a-z0-9_]/g, '_')
      });
    } else {
      res.status(400).json({ error: 'Column already exists' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Import from Excel/CSV file
app.post('/api/import/file', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  try {
    let data;
    const filePath = req.file.path;
    const fileExtension = path.extname(req.file.originalname).toLowerCase();

    if (fileExtension === '.csv') {
      // Handle CSV files
      const workbook = xlsx.readFile(filePath, { type: 'file' });
      const sheetName = workbook.SheetNames[0];
      data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    } else {
      // Handle Excel files
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    }

    if (!data || data.length === 0) {
      res.status(400).json({ error: 'No data found in file' });
      return;
    }

    // Analyze columns and add new ones if needed
    const sampleRow = data[0];
    const fileColumns = Object.keys(sampleRow);
    const newColumnsAdded = [];

    for (const col of fileColumns) {
      const sanitizedCol = col.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const allColumns = getAllColumns();
      
      if (!allColumns[sanitizedCol] && sanitizedCol !== 'item') {
        try {
          const added = await addColumn(col);
          if (added) {
            newColumnsAdded.push(sanitizedCol);
          }
        } catch (error) {
          console.error(`Error adding column ${col}:`, error);
        }
      }
    }

    // Import data
    let imported = 0;
    let errors = [];

    for (const row of data) {
      try {
        // Map file column names to database column names
        const mappedRow = {};
        Object.keys(row).forEach(key => {
          const sanitizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
          mappedRow[sanitizedKey] = row[key];
        });

        if (!mappedRow.item) {
          errors.push(`Row missing item code: ${JSON.stringify(row)}`);
          continue;
        }

        const allColumns = getAllColumns();
        const columns = Object.keys(mappedRow).filter(key => 
          allColumns[key] !== undefined
        );
        
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map(col => mappedRow[col]);
        
        const query = `INSERT OR REPLACE INTO products (${columns.join(', ')}, updated_at) 
                       VALUES (${placeholders}, CURRENT_TIMESTAMP)`;
        
        await new Promise((resolve, reject) => {
          db.run(query, values, function(err) {
            if (err) reject(err);
            else resolve();
          });
        });
        
        imported++;
      } catch (error) {
        errors.push(`Error importing row: ${error.message}`);
      }
    }

    // Clean up uploaded file
    require('fs').unlinkSync(filePath);

    res.json({
      message: 'Import completed',
      imported,
      errors: errors.length > 0 ? errors : undefined,
      newColumnsAdded
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Import from paste data
app.post('/api/import/paste', async (req, res) => {
  const { data, delimiter = '\t' } = req.body;
  
  if (!data) {
    res.status(400).json({ error: 'No data provided' });
    return;
  }

  try {
    const lines = data.trim().split('\n');
    if (lines.length === 0) {
      res.status(400).json({ error: 'No data lines found' });
      return;
    }

    // Parse first line to determine if it's headers or data
    const firstLine = lines[0].split(delimiter);
    const isFirstLineHeader = firstLine.some(cell => 
      isNaN(parseFloat(cell)) && !cell.match(/^\$?\d+\.?\d*$/)
    );

    let headers;
    let dataLines;

    if (isFirstLineHeader) {
      headers = firstLine.map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
      dataLines = lines.slice(1);
    } else {
      // Use default column order from your original spec
      headers = ['item', 'description', 'grp_sect', 'onhand', 'um', 'committed', 'onorder', 'unit_price', 'um2'];
      dataLines = lines;
    }

    // Add new columns if needed
    const newColumnsAdded = [];
    for (const header of headers) {
      const allColumns = getAllColumns();
      if (!allColumns[header] && header !== 'item') {
        try {
          const added = await addColumn(header);
          if (added) {
            newColumnsAdded.push(header);
          }
        } catch (error) {
          console.error(`Error adding column ${header}:`, error);
        }
      }
    }

    let imported = 0;
    let errors = [];

    for (const line of dataLines) {
      try {
        const values = line.split(delimiter).map(v => v.trim());
        if (values.length === 0 || !values[0]) continue;

        const rowData = {};
        headers.forEach((header, index) => {
          if (values[index] !== undefined) {
            let value = values[index];
            
            // Clean up currency values
            if (value.startsWith('$')) {
              value = value.substring(1);
            }
            
            // Convert numeric values
            if (['onhand', 'committed', 'onorder', 'unit_price'].includes(header)) {
              value = parseFloat(value) || 0;
            }
            
            rowData[header] = value;
          }
        });

        if (!rowData.item) {
          errors.push(`Row missing item code: ${line}`);
          continue;
        }

        const allColumns = getAllColumns();
        const columns = Object.keys(rowData).filter(key => 
          allColumns[key] !== undefined
        );
        
        const placeholders = columns.map(() => '?').join(', ');
        const columnValues = columns.map(col => rowData[col]);
        
        const query = `INSERT OR REPLACE INTO products (${columns.join(', ')}, updated_at) 
                       VALUES (${placeholders}, CURRENT_TIMESTAMP)`;
        
        await new Promise((resolve, reject) => {
          db.run(query, columnValues, function(err) {
            if (err) reject(err);
            else resolve();
          });
        });
        
        imported++;
      } catch (error) {
        errors.push(`Error importing line: ${error.message}`);
      }
    }

    res.json({
      message: 'Import completed',
      imported,
      errors: errors.length > 0 ? errors : undefined,
      newColumnsAdded
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export data
app.get('/api/export/:format', (req, res) => {
  const format = req.params.format.toLowerCase();
  
  db.all("SELECT * FROM products ORDER BY item", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    if (format === 'json') {
      res.setHeader('Content-Disposition', 'attachment; filename=products.json');
      res.setHeader('Content-Type', 'application/json');
      res.json(rows);
    } else if (format === 'csv') {
      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Products');
      
      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'csv' });
      
      res.setHeader('Content-Disposition', 'attachment; filename=products.csv');
      res.setHeader('Content-Type', 'text/csv');
      res.send(buffer);
    } else if (format === 'excel') {
      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Products');
      
      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Disposition', 'attachment; filename=products.xlsx');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(buffer);
    } else {
      res.status(400).json({ error: 'Unsupported format' });
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database closed.');
    }
    process.exit(0);
  });
});)) {
              value = value.substring(1);
            }
            
            // Convert numeric values
            if (['onhand', 'committed', 'onorder', 'unit_price'].includes(header)) {
              value = parseFloat(value) || 0;
            }
            
            rowData[header] = value;
          }
        });

        if (!rowData.item) {
          errors.push(`Row missing item code: ${line}`);
          continue;
        }

        const allColumns = getAllColumns();
        const columns = Object.keys(rowData).filter(key => 
          allColumns[key] !== undefined
        );
        
        const columnValues = columns.map(col => rowData[col]);
        
        const query = `INSERT OR REPLACE INTO products (${columns.join(', ')}, updated_at) 
                       VALUES (${'?, '.repeat(columns.length).slice(0, -2)}, CURRENT_TIMESTAMP)`;
        
        const stmt = db.prepare(query);
        stmt.run(...columnValues);
        
        imported++;
      } catch (error) {
        errors.push(`Error importing line: ${error.message}`);
      }
    }

    res.json({
      message: 'Import completed',
      imported,
      errors: errors.length > 0 ? errors : undefined,
      newColumnsAdded
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export data
app.get('/api/export/:format', (req, res) => {
  const format = req.params.format.toLowerCase();
  
  try {
    const rows = db.prepare("SELECT * FROM products ORDER BY item").all();

    if (format === 'json') {
      res.setHeader('Content-Disposition', 'attachment; filename=products.json');
      res.setHeader('Content-Type', 'application/json');
      res.json(rows);
    } else if (format === 'csv') {
      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Products');
      
      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'csv' });
      
      res.setHeader('Content-Disposition', 'attachment; filename=products.csv');
      res.setHeader('Content-Type', 'text/csv');
      res.send(buffer);
    } else if (format === 'excel') {
      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Products');
      
      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Disposition', 'attachment; filename=products.xlsx');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(buffer);
    } else {
      res.status(400).json({ error: 'Unsupported format' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  db.close();
  process.exit(0);
});

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    const allowedTypes = /xlsx|xls|csv/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || 
                    file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                    file.mimetype === 'application/vnd.ms-excel' ||
                    file.mimetype === 'text/csv';
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only Excel and CSV files are allowed'));
    }
  }
});

// Initialize SQLite database
const db = new sqlite3.Database('./products.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    initializeDatabase();
  }
});

// Core column definitions
const coreColumns = {
  item: 'TEXT PRIMARY KEY',
  description: 'TEXT',
  grp_sect: 'TEXT',
  onhand: 'REAL',
  um: 'TEXT',
  committed: 'REAL',
  onorder: 'REAL',
  unit_price: 'REAL',
  um2: 'TEXT'
};

// Dynamic columns storage
let dynamicColumns = {};

function initializeDatabase() {
  // Create core products table
  const coreColumnsStr = Object.entries(coreColumns)
    .map(([name, type]) => `${name} ${type}`)
    .join(', ');
  
  db.run(`CREATE TABLE IF NOT EXISTS products (
    ${coreColumnsStr},
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Create table to track dynamic columns
  db.run(`CREATE TABLE IF NOT EXISTS column_definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    column_name TEXT UNIQUE,
    column_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Load existing dynamic columns
  loadDynamicColumns();
}

function loadDynamicColumns() {
  db.all("SELECT column_name, column_type FROM column_definitions", (err, rows) => {
    if (err) {
      console.error('Error loading dynamic columns:', err);
      return;
    }
    
    rows.forEach(row => {
      dynamicColumns[row.column_name] = row.column_type;
    });
    
    console.log('Loaded dynamic columns:', dynamicColumns);
  });
}

// Add new column to database
function addColumn(columnName, columnType = 'TEXT') {
  return new Promise((resolve, reject) => {
    const sanitizedName = columnName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    
    if (coreColumns[sanitizedName] || dynamicColumns[sanitizedName]) {
      resolve(false); // Column already exists
      return;
    }

    db.run(`ALTER TABLE products ADD COLUMN ${sanitizedName} ${columnType}`, (err) => {
      if (err) {
        console.error('Error adding column:', err);
        reject(err);
        return;
      }

      // Save column definition
      db.run("INSERT INTO column_definitions (column_name, column_type) VALUES (?, ?)", 
        [sanitizedName, columnType], (err) => {
        if (err) {
          console.error('Error saving column definition:', err);
          reject(err);
          return;
        }

        dynamicColumns[sanitizedName] = columnType;
        resolve(true);
      });
    });
  });
}

// Get all columns (core + dynamic)
function getAllColumns() {
  return { ...coreColumns, ...dynamicColumns };
}

// Routes

// Get all products
app.get('/api/products', (req, res) => {
  db.all("SELECT * FROM products ORDER BY item", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Get single product
app.get('/api/products/:item', (req, res) => {
  db.get("SELECT * FROM products WHERE item = ?", [req.params.item], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json(row);
  });
});

// Create or update product
app.post('/api/products', (req, res) => {
  const data = req.body;
  const allColumns = getAllColumns();
  
  // Validate required fields
  if (!data.item) {
    res.status(400).json({ error: 'Item code is required' });
    return;
  }

  // Prepare columns and values for insert/update
  const columns = Object.keys(data).filter(key => 
    allColumns[key] !== undefined || key === 'item'
  );
  
  const placeholders = columns.map(() => '?').join(', ');
  const values = columns.map(col => data[col]);
  
  const updatePlaceholders = columns
    .filter(col => col !== 'item')
    .map(col => `${col} = ?`)
    .join(', ');
  
  const updateValues = columns
    .filter(col => col !== 'item')
    .map(col => data[col]);

  // Use INSERT OR REPLACE for upsert functionality
  const query = `INSERT OR REPLACE INTO products (${columns.join(', ')}, updated_at) 
                 VALUES (${placeholders}, CURRENT_TIMESTAMP)`;
  
  db.run(query, values, function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ 
      message: this.changes > 0 ? 'Product saved successfully' : 'Product created successfully',
      item: data.item 
    });
  });
});

// Delete product
app.delete('/api/products/:item', (req, res) => {
  db.run("DELETE FROM products WHERE item = ?", [req.params.item], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (this.changes === 0) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json({ message: 'Product deleted successfully' });
  });
});

// Get column definitions
app.get('/api/columns', (req, res) => {
  res.json({
    core: coreColumns,
    dynamic: dynamicColumns,
    all: getAllColumns()
  });
});

// Add new column
app.post('/api/columns', async (req, res) => {
  const { columnName, columnType = 'TEXT' } = req.body;
  
  if (!columnName) {
    res.status(400).json({ error: 'Column name is required' });
    return;
  }

  try {
    const added = await addColumn(columnName, columnType);
    if (added) {
      res.json({ 
        message: 'Column added successfully',
        columnName: columnName.toLowerCase().replace(/[^a-z0-9_]/g, '_')
      });
    } else {
      res.status(400).json({ error: 'Column already exists' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Import from Excel/CSV file
app.post('/api/import/file', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  try {
    let data;
    const filePath = req.file.path;
    const fileExtension = path.extname(req.file.originalname).toLowerCase();

    if (fileExtension === '.csv') {
      // Handle CSV files
      const workbook = xlsx.readFile(filePath, { type: 'file' });
      const sheetName = workbook.SheetNames[0];
      data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    } else {
      // Handle Excel files
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    }

    if (!data || data.length === 0) {
      res.status(400).json({ error: 'No data found in file' });
      return;
    }

    // Analyze columns and add new ones if needed
    const sampleRow = data[0];
    const fileColumns = Object.keys(sampleRow);
    const newColumnsAdded = [];

    for (const col of fileColumns) {
      const sanitizedCol = col.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const allColumns = getAllColumns();
      
      if (!allColumns[sanitizedCol] && sanitizedCol !== 'item') {
        try {
          const added = await addColumn(col);
          if (added) {
            newColumnsAdded.push(sanitizedCol);
          }
        } catch (error) {
          console.error(`Error adding column ${col}:`, error);
        }
      }
    }

    // Import data
    let imported = 0;
    let errors = [];

    for (const row of data) {
      try {
        // Map file column names to database column names
        const mappedRow = {};
        Object.keys(row).forEach(key => {
          const sanitizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
          mappedRow[sanitizedKey] = row[key];
        });

        if (!mappedRow.item) {
          errors.push(`Row missing item code: ${JSON.stringify(row)}`);
          continue;
        }

        const allColumns = getAllColumns();
        const columns = Object.keys(mappedRow).filter(key => 
          allColumns[key] !== undefined
        );
        
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map(col => mappedRow[col]);
        
        const query = `INSERT OR REPLACE INTO products (${columns.join(', ')}, updated_at) 
                       VALUES (${placeholders}, CURRENT_TIMESTAMP)`;
        
        await new Promise((resolve, reject) => {
          db.run(query, values, function(err) {
            if (err) reject(err);
            else resolve();
          });
        });
        
        imported++;
      } catch (error) {
        errors.push(`Error importing row: ${error.message}`);
      }
    }

    // Clean up uploaded file
    require('fs').unlinkSync(filePath);

    res.json({
      message: 'Import completed',
      imported,
      errors: errors.length > 0 ? errors : undefined,
      newColumnsAdded
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Import from paste data
app.post('/api/import/paste', async (req, res) => {
  const { data, delimiter = '\t' } = req.body;
  
  if (!data) {
    res.status(400).json({ error: 'No data provided' });
    return;
  }

  try {
    const lines = data.trim().split('\n');
    if (lines.length === 0) {
      res.status(400).json({ error: 'No data lines found' });
      return;
    }

    // Parse first line to determine if it's headers or data
    const firstLine = lines[0].split(delimiter);
    const isFirstLineHeader = firstLine.some(cell => 
      isNaN(parseFloat(cell)) && !cell.match(/^\$?\d+\.?\d*$/)
    );

    let headers;
    let dataLines;

    if (isFirstLineHeader) {
      headers = firstLine.map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
      dataLines = lines.slice(1);
    } else {
      // Use default column order from your original spec
      headers = ['item', 'description', 'grp_sect', 'onhand', 'um', 'committed', 'onorder', 'unit_price', 'um2'];
      dataLines = lines;
    }

    // Add new columns if needed
    const newColumnsAdded = [];
    for (const header of headers) {
      const allColumns = getAllColumns();
      if (!allColumns[header] && header !== 'item') {
        try {
          const added = await addColumn(header);
          if (added) {
            newColumnsAdded.push(header);
          }
        } catch (error) {
          console.error(`Error adding column ${header}:`, error);
        }
      }
    }

    let imported = 0;
    let errors = [];

    for (const line of dataLines) {
      try {
        const values = line.split(delimiter).map(v => v.trim());
        if (values.length === 0 || !values[0]) continue;

        const rowData = {};
        headers.forEach((header, index) => {
          if (values[index] !== undefined) {
            let value = values[index];
            
            // Clean up currency values
            if (value.startsWith('$')) {
              value = value.substring(1);
            }
            
            // Convert numeric values
            if (['onhand', 'committed', 'onorder', 'unit_price'].includes(header)) {
              value = parseFloat(value) || 0;
            }
            
            rowData[header] = value;
          }
        });

        if (!rowData.item) {
          errors.push(`Row missing item code: ${line}`);
          continue;
        }

        const allColumns = getAllColumns();
        const columns = Object.keys(rowData).filter(key => 
          allColumns[key] !== undefined
        );
        
        const placeholders = columns.map(() => '?').join(', ');
        const columnValues = columns.map(col => rowData[col]);
        
        const query = `INSERT OR REPLACE INTO products (${columns.join(', ')}, updated_at) 
                       VALUES (${placeholders}, CURRENT_TIMESTAMP)`;
        
        await new Promise((resolve, reject) => {
          db.run(query, columnValues, function(err) {
            if (err) reject(err);
            else resolve();
          });
        });
        
        imported++;
      } catch (error) {
        errors.push(`Error importing line: ${error.message}`);
      }
    }

    res.json({
      message: 'Import completed',
      imported,
      errors: errors.length > 0 ? errors : undefined,
      newColumnsAdded
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export data
app.get('/api/export/:format', (req, res) => {
  const format = req.params.format.toLowerCase();
  
  db.all("SELECT * FROM products ORDER BY item", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    if (format === 'json') {
      res.setHeader('Content-Disposition', 'attachment; filename=products.json');
      res.setHeader('Content-Type', 'application/json');
      res.json(rows);
    } else if (format === 'csv') {
      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Products');
      
      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'csv' });
      
      res.setHeader('Content-Disposition', 'attachment; filename=products.csv');
      res.setHeader('Content-Type', 'text/csv');
      res.send(buffer);
    } else if (format === 'excel') {
      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Products');
      
      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Disposition', 'attachment; filename=products.xlsx');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(buffer);
    } else {
      res.status(400).json({ error: 'Unsupported format' });
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database closed.');
    }
    process.exit(0);
  });
});)) {
              value = value.substring(1);
            }
            
            // Convert numeric values
            if (['onhand', 'committed', 'onorder', 'unit_price'].includes(header)) {
              value = parseFloat(value) || 0;
            }
            
            rowData[header] = value;
          }
        });

        if (!rowData.item) {
          errors.push(`Row missing item code: ${line}`);
          continue;
        }

        // Add timestamps
        const now = new Date().toISOString();
        rowData.updated_at = now;
        
        const existingIndex = products.findIndex(p => p.item === rowData.item);
        if (existingIndex >= 0) {
          products[existingIndex] = { ...products[existingIndex], ...rowData };
        } else {
          rowData.created_at = now;
          products.push(rowData);
        }
        
        imported++;
      } catch (error) {
        errors.push(`Error importing line: ${error.message}`);
      }
    }

    writeProducts(products);

    res.json({
      message: 'Import completed',
      imported,
      errors: errors.length > 0 ? errors : undefined,
      newColumnsAdded
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export data
app.get('/api/export/:format', (req, res) => {
  const format = req.params.format.toLowerCase();
  
  try {
    const products = readProducts();

    if (format === 'json') {
      res.setHeader('Content-Disposition', 'attachment; filename=products.json');
      res.setHeader('Content-Type', 'application/json');
      res.json(products);
    } else if (format === 'csv') {
      const ws = xlsx.utils.json_to_sheet(products);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Products');
      
      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'csv' });
      
      res.setHeader('Content-Disposition', 'attachment; filename=products.csv');
      res.setHeader('Content-Type', 'text/csv');
      res.send(buffer);
    } else if (format === 'excel') {
      const ws = xlsx.utils.json_to_sheet(products);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Products');
      
      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Disposition', 'attachment; filename=products.xlsx');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(buffer);
    } else {
      res.status(400).json({ error: 'Unsupported format' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  process.exit(0);
});
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    const allowedTypes = /xlsx|xls|csv/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || 
                    file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                    file.mimetype === 'application/vnd.ms-excel' ||
                    file.mimetype === 'text/csv';
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only Excel and CSV files are allowed'));
    }
  }
});

// Initialize better-sqlite3 database
const db = new Database('./products.db');
console.log('Connected to SQLite database.');

// Core column definitions
const coreColumns = {
  item: 'TEXT PRIMARY KEY',
  description: 'TEXT',
  grp_sect: 'TEXT',
  onhand: 'REAL',
  um: 'TEXT',
  committed: 'REAL',
  onorder: 'REAL',
  unit_price: 'REAL',
  um2: 'TEXT'
};

// Dynamic columns storage
let dynamicColumns = {};

function initializeDatabase() {
  // Create core products table
  const coreColumnsStr = Object.entries(coreColumns)
    .map(([name, type]) => `${name} ${type}`)
    .join(', ');
  
  db.exec(`CREATE TABLE IF NOT EXISTS products (
    ${coreColumnsStr},
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Create table to track dynamic columns
  db.exec(`CREATE TABLE IF NOT EXISTS column_definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    column_name TEXT UNIQUE,
    column_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Load existing dynamic columns
  loadDynamicColumns();
}

function loadDynamicColumns() {
  try {
    const rows = db.prepare("SELECT column_name, column_type FROM column_definitions").all();
    rows.forEach(row => {
      dynamicColumns[row.column_name] = row.column_type;
    });
    console.log('Loaded dynamic columns:', dynamicColumns);
  } catch (error) {
    console.error('Error loading dynamic columns:', error);
  }
}

// Add new column to database
function addColumn(columnName, columnType = 'TEXT') {
  const sanitizedName = columnName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  
  if (coreColumns[sanitizedName] || dynamicColumns[sanitizedName]) {
    return false; // Column already exists
  }

  try {
    db.exec(`ALTER TABLE products ADD COLUMN ${sanitizedName} ${columnType}`);
    
    // Save column definition
    const stmt = db.prepare("INSERT INTO column_definitions (column_name, column_type) VALUES (?, ?)");
    stmt.run(sanitizedName, columnType);
    
    dynamicColumns[sanitizedName] = columnType;
    return true;
  } catch (error) {
    console.error('Error adding column:', error);
    throw error;
  }
}

// Get all columns (core + dynamic)
function getAllColumns() {
  return { ...coreColumns, ...dynamicColumns };
}

// Initialize database
initializeDatabase();

// Routes

// Get all products
app.get('/api/products', (req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM products ORDER BY item").all();
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single product
app.get('/api/products/:item', (req, res) => {
  try {
    const row = db.prepare("SELECT * FROM products WHERE item = ?").get(req.params.item);
    if (!row) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json(row);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create or update product
app.post('/api/products', (req, res) => {
  const data = req.body;
  const allColumns = getAllColumns();
  
  // Validate required fields
  if (!data.item) {
    res.status(400).json({ error: 'Item code is required' });
    return;
  }

  try {
    // Prepare columns and values for insert/update
    const columns = Object.keys(data).filter(key => 
      allColumns[key] !== undefined || key === 'item'
    );
    
    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map(col => data[col]);
    
    // Use INSERT OR REPLACE for upsert functionality
    const query = `INSERT OR REPLACE INTO products (${columns.join(', ')}, updated_at) 
                   VALUES (${placeholders}, CURRENT_TIMESTAMP)`;
    
    const stmt = db.prepare(query);
    const result = stmt.run(...values);
    
    res.json({ 
      message: result.changes > 0 ? 'Product saved successfully' : 'Product created successfully',
      item: data.item 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete product
app.delete('/api/products/:item', (req, res) => {
  try {
    const stmt = db.prepare("DELETE FROM products WHERE item = ?");
    const result = stmt.run(req.params.item);
    
    if (result.changes === 0) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get column definitions
app.get('/api/columns', (req, res) => {
  res.json({
    core: coreColumns,
    dynamic: dynamicColumns,
    all: getAllColumns()
  });
});

// Add new column
app.post('/api/columns', (req, res) => {
  const { columnName, columnType = 'TEXT' } = req.body;
  
  if (!columnName) {
    res.status(400).json({ error: 'Column name is required' });
    return;
  }

  try {
    const added = addColumn(columnName, columnType);
    if (added) {
      res.json({ 
        message: 'Column added successfully',
        columnName: columnName.toLowerCase().replace(/[^a-z0-9_]/g, '_')
      });
    } else {
      res.status(400).json({ error: 'Column already exists' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Import from Excel/CSV file
app.post('/api/import/file', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  try {
    let data;
    const filePath = req.file.path;
    const fileExtension = path.extname(req.file.originalname).toLowerCase();

    if (fileExtension === '.csv') {
      // Handle CSV files
      const workbook = xlsx.readFile(filePath, { type: 'file' });
      const sheetName = workbook.SheetNames[0];
      data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    } else {
      // Handle Excel files
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    }

    if (!data || data.length === 0) {
      res.status(400).json({ error: 'No data found in file' });
      return;
    }

    // Analyze columns and add new ones if needed
    const sampleRow = data[0];
    const fileColumns = Object.keys(sampleRow);
    const newColumnsAdded = [];

    for (const col of fileColumns) {
      const sanitizedCol = col.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const allColumns = getAllColumns();
      
      if (!allColumns[sanitizedCol] && sanitizedCol !== 'item') {
        try {
          const added = addColumn(col);
          if (added) {
            newColumnsAdded.push(sanitizedCol);
          }
        } catch (error) {
          console.error(`Error adding column ${col}:`, error);
        }
      }
    }

    // Import data
    let imported = 0;
    let errors = [];

    const insertStmt = db.prepare(`INSERT OR REPLACE INTO products VALUES (${'?, '.repeat(Object.keys(getAllColumns()).length + 2).slice(0, -2)})`);

    for (const row of data) {
      try {
        // Map file column names to database column names
        const mappedRow = {};
        Object.keys(row).forEach(key => {
          const sanitizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
          mappedRow[sanitizedKey] = row[key];
        });

        if (!mappedRow.item) {
          errors.push(`Row missing item code: ${JSON.stringify(row)}`);
          continue;
        }

        const allColumns = getAllColumns();
        const columns = Object.keys(mappedRow).filter(key => 
          allColumns[key] !== undefined
        );
        
        const values = columns.map(col => mappedRow[col]);
        values.push(new Date().toISOString()); // created_at
        values.push(new Date().toISOString()); // updated_at
        
        const query = `INSERT OR REPLACE INTO products (${columns.join(', ')}, created_at, updated_at) 
                       VALUES (${'?, '.repeat(values.length).slice(0, -2)})`;
        
        const stmt = db.prepare(query);
        stmt.run(...values);
        
        imported++;
      } catch (error) {
        errors.push(`Error importing row: ${error.message}`);
      }
    }

    // Clean up uploaded file
    require('fs').unlinkSync(filePath);

    res.json({
      message: 'Import completed',
      imported,
      errors: errors.length > 0 ? errors : undefined,
      newColumnsAdded
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Import from paste data
app.post('/api/import/paste', (req, res) => {
  const { data, delimiter = '\t' } = req.body;
  
  if (!data) {
    res.status(400).json({ error: 'No data provided' });
    return;
  }

  try {
    const lines = data.trim().split('\n');
    if (lines.length === 0) {
      res.status(400).json({ error: 'No data lines found' });
      return;
    }

    // Parse first line to determine if it's headers or data
    const firstLine = lines[0].split(delimiter);
    const isFirstLineHeader = firstLine.some(cell => 
      isNaN(parseFloat(cell)) && !cell.match(/^\$?\d+\.?\d*$/)
    );

    let headers;
    let dataLines;

    if (isFirstLineHeader) {
      headers = firstLine.map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
      dataLines = lines.slice(1);
    } else {
      // Use default column order from your original spec
      headers = ['item', 'description', 'grp_sect', 'onhand', 'um', 'committed', 'onorder', 'unit_price', 'um2'];
      dataLines = lines;
    }

    // Add new columns if needed
    const newColumnsAdded = [];
    for (const header of headers) {
      const allColumns = getAllColumns();
      if (!allColumns[header] && header !== 'item') {
        try {
          const added = addColumn(header);
          if (added) {
            newColumnsAdded.push(header);
          }
        } catch (error) {
          console.error(`Error adding column ${header}:`, error);
        }
      }
    }

    let imported = 0;
    let errors = [];

    for (const line of dataLines) {
      try {
        const values = line.split(delimiter).map(v => v.trim());
        if (values.length === 0 || !values[0]) continue;

        const rowData = {};
        headers.forEach((header, index) => {
          if (values[index] !== undefined) {
            let value = values[index];
            
            // Clean up currency values
            if (value.startsWith('

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    const allowedTypes = /xlsx|xls|csv/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || 
                    file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                    file.mimetype === 'application/vnd.ms-excel' ||
                    file.mimetype === 'text/csv';
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only Excel and CSV files are allowed'));
    }
  }
});

// Initialize SQLite database
const db = new sqlite3.Database('./products.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    initializeDatabase();
  }
});

// Core column definitions
const coreColumns = {
  item: 'TEXT PRIMARY KEY',
  description: 'TEXT',
  grp_sect: 'TEXT',
  onhand: 'REAL',
  um: 'TEXT',
  committed: 'REAL',
  onorder: 'REAL',
  unit_price: 'REAL',
  um2: 'TEXT'
};

// Dynamic columns storage
let dynamicColumns = {};

function initializeDatabase() {
  // Create core products table
  const coreColumnsStr = Object.entries(coreColumns)
    .map(([name, type]) => `${name} ${type}`)
    .join(', ');
  
  db.run(`CREATE TABLE IF NOT EXISTS products (
    ${coreColumnsStr},
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Create table to track dynamic columns
  db.run(`CREATE TABLE IF NOT EXISTS column_definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    column_name TEXT UNIQUE,
    column_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Load existing dynamic columns
  loadDynamicColumns();
}

function loadDynamicColumns() {
  db.all("SELECT column_name, column_type FROM column_definitions", (err, rows) => {
    if (err) {
      console.error('Error loading dynamic columns:', err);
      return;
    }
    
    rows.forEach(row => {
      dynamicColumns[row.column_name] = row.column_type;
    });
    
    console.log('Loaded dynamic columns:', dynamicColumns);
  });
}

// Add new column to database
function addColumn(columnName, columnType = 'TEXT') {
  return new Promise((resolve, reject) => {
    const sanitizedName = columnName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    
    if (coreColumns[sanitizedName] || dynamicColumns[sanitizedName]) {
      resolve(false); // Column already exists
      return;
    }

    db.run(`ALTER TABLE products ADD COLUMN ${sanitizedName} ${columnType}`, (err) => {
      if (err) {
        console.error('Error adding column:', err);
        reject(err);
        return;
      }

      // Save column definition
      db.run("INSERT INTO column_definitions (column_name, column_type) VALUES (?, ?)", 
        [sanitizedName, columnType], (err) => {
        if (err) {
          console.error('Error saving column definition:', err);
          reject(err);
          return;
        }

        dynamicColumns[sanitizedName] = columnType;
        resolve(true);
      });
    });
  });
}

// Get all columns (core + dynamic)
function getAllColumns() {
  return { ...coreColumns, ...dynamicColumns };
}

// Routes

// Get all products
app.get('/api/products', (req, res) => {
  db.all("SELECT * FROM products ORDER BY item", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Get single product
app.get('/api/products/:item', (req, res) => {
  db.get("SELECT * FROM products WHERE item = ?", [req.params.item], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json(row);
  });
});

// Create or update product
app.post('/api/products', (req, res) => {
  const data = req.body;
  const allColumns = getAllColumns();
  
  // Validate required fields
  if (!data.item) {
    res.status(400).json({ error: 'Item code is required' });
    return;
  }

  // Prepare columns and values for insert/update
  const columns = Object.keys(data).filter(key => 
    allColumns[key] !== undefined || key === 'item'
  );
  
  const placeholders = columns.map(() => '?').join(', ');
  const values = columns.map(col => data[col]);
  
  const updatePlaceholders = columns
    .filter(col => col !== 'item')
    .map(col => `${col} = ?`)
    .join(', ');
  
  const updateValues = columns
    .filter(col => col !== 'item')
    .map(col => data[col]);

  // Use INSERT OR REPLACE for upsert functionality
  const query = `INSERT OR REPLACE INTO products (${columns.join(', ')}, updated_at) 
                 VALUES (${placeholders}, CURRENT_TIMESTAMP)`;
  
  db.run(query, values, function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ 
      message: this.changes > 0 ? 'Product saved successfully' : 'Product created successfully',
      item: data.item 
    });
  });
});

// Delete product
app.delete('/api/products/:item', (req, res) => {
  db.run("DELETE FROM products WHERE item = ?", [req.params.item], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (this.changes === 0) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json({ message: 'Product deleted successfully' });
  });
});

// Get column definitions
app.get('/api/columns', (req, res) => {
  res.json({
    core: coreColumns,
    dynamic: dynamicColumns,
    all: getAllColumns()
  });
});

// Add new column
app.post('/api/columns', async (req, res) => {
  const { columnName, columnType = 'TEXT' } = req.body;
  
  if (!columnName) {
    res.status(400).json({ error: 'Column name is required' });
    return;
  }

  try {
    const added = await addColumn(columnName, columnType);
    if (added) {
      res.json({ 
        message: 'Column added successfully',
        columnName: columnName.toLowerCase().replace(/[^a-z0-9_]/g, '_')
      });
    } else {
      res.status(400).json({ error: 'Column already exists' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Import from Excel/CSV file
app.post('/api/import/file', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  try {
    let data;
    const filePath = req.file.path;
    const fileExtension = path.extname(req.file.originalname).toLowerCase();

    if (fileExtension === '.csv') {
      // Handle CSV files
      const workbook = xlsx.readFile(filePath, { type: 'file' });
      const sheetName = workbook.SheetNames[0];
      data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    } else {
      // Handle Excel files
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    }

    if (!data || data.length === 0) {
      res.status(400).json({ error: 'No data found in file' });
      return;
    }

    // Analyze columns and add new ones if needed
    const sampleRow = data[0];
    const fileColumns = Object.keys(sampleRow);
    const newColumnsAdded = [];

    for (const col of fileColumns) {
      const sanitizedCol = col.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const allColumns = getAllColumns();
      
      if (!allColumns[sanitizedCol] && sanitizedCol !== 'item') {
        try {
          const added = await addColumn(col);
          if (added) {
            newColumnsAdded.push(sanitizedCol);
          }
        } catch (error) {
          console.error(`Error adding column ${col}:`, error);
        }
      }
    }

    // Import data
    let imported = 0;
    let errors = [];

    for (const row of data) {
      try {
        // Map file column names to database column names
        const mappedRow = {};
        Object.keys(row).forEach(key => {
          const sanitizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
          mappedRow[sanitizedKey] = row[key];
        });

        if (!mappedRow.item) {
          errors.push(`Row missing item code: ${JSON.stringify(row)}`);
          continue;
        }

        const allColumns = getAllColumns();
        const columns = Object.keys(mappedRow).filter(key => 
          allColumns[key] !== undefined
        );
        
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map(col => mappedRow[col]);
        
        const query = `INSERT OR REPLACE INTO products (${columns.join(', ')}, updated_at) 
                       VALUES (${placeholders}, CURRENT_TIMESTAMP)`;
        
        await new Promise((resolve, reject) => {
          db.run(query, values, function(err) {
            if (err) reject(err);
            else resolve();
          });
        });
        
        imported++;
      } catch (error) {
        errors.push(`Error importing row: ${error.message}`);
      }
    }

    // Clean up uploaded file
    require('fs').unlinkSync(filePath);

    res.json({
      message: 'Import completed',
      imported,
      errors: errors.length > 0 ? errors : undefined,
      newColumnsAdded
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Import from paste data
app.post('/api/import/paste', async (req, res) => {
  const { data, delimiter = '\t' } = req.body;
  
  if (!data) {
    res.status(400).json({ error: 'No data provided' });
    return;
  }

  try {
    const lines = data.trim().split('\n');
    if (lines.length === 0) {
      res.status(400).json({ error: 'No data lines found' });
      return;
    }

    // Parse first line to determine if it's headers or data
    const firstLine = lines[0].split(delimiter);
    const isFirstLineHeader = firstLine.some(cell => 
      isNaN(parseFloat(cell)) && !cell.match(/^\$?\d+\.?\d*$/)
    );

    let headers;
    let dataLines;

    if (isFirstLineHeader) {
      headers = firstLine.map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
      dataLines = lines.slice(1);
    } else {
      // Use default column order from your original spec
      headers = ['item', 'description', 'grp_sect', 'onhand', 'um', 'committed', 'onorder', 'unit_price', 'um2'];
      dataLines = lines;
    }

    // Add new columns if needed
    const newColumnsAdded = [];
    for (const header of headers) {
      const allColumns = getAllColumns();
      if (!allColumns[header] && header !== 'item') {
        try {
          const added = await addColumn(header);
          if (added) {
            newColumnsAdded.push(header);
          }
        } catch (error) {
          console.error(`Error adding column ${header}:`, error);
        }
      }
    }

    let imported = 0;
    let errors = [];

    for (const line of dataLines) {
      try {
        const values = line.split(delimiter).map(v => v.trim());
        if (values.length === 0 || !values[0]) continue;

        const rowData = {};
        headers.forEach((header, index) => {
          if (values[index] !== undefined) {
            let value = values[index];
            
            // Clean up currency values
            if (value.startsWith('$')) {
              value = value.substring(1);
            }
            
            // Convert numeric values
            if (['onhand', 'committed', 'onorder', 'unit_price'].includes(header)) {
              value = parseFloat(value) || 0;
            }
            
            rowData[header] = value;
          }
        });

        if (!rowData.item) {
          errors.push(`Row missing item code: ${line}`);
          continue;
        }

        const allColumns = getAllColumns();
        const columns = Object.keys(rowData).filter(key => 
          allColumns[key] !== undefined
        );
        
        const placeholders = columns.map(() => '?').join(', ');
        const columnValues = columns.map(col => rowData[col]);
        
        const query = `INSERT OR REPLACE INTO products (${columns.join(', ')}, updated_at) 
                       VALUES (${placeholders}, CURRENT_TIMESTAMP)`;
        
        await new Promise((resolve, reject) => {
          db.run(query, columnValues, function(err) {
            if (err) reject(err);
            else resolve();
          });
        });
        
        imported++;
      } catch (error) {
        errors.push(`Error importing line: ${error.message}`);
      }
    }

    res.json({
      message: 'Import completed',
      imported,
      errors: errors.length > 0 ? errors : undefined,
      newColumnsAdded
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export data
app.get('/api/export/:format', (req, res) => {
  const format = req.params.format.toLowerCase();
  
  db.all("SELECT * FROM products ORDER BY item", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    if (format === 'json') {
      res.setHeader('Content-Disposition', 'attachment; filename=products.json');
      res.setHeader('Content-Type', 'application/json');
      res.json(rows);
    } else if (format === 'csv') {
      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Products');
      
      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'csv' });
      
      res.setHeader('Content-Disposition', 'attachment; filename=products.csv');
      res.setHeader('Content-Type', 'text/csv');
      res.send(buffer);
    } else if (format === 'excel') {
      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Products');
      
      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Disposition', 'attachment; filename=products.xlsx');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(buffer);
    } else {
      res.status(400).json({ error: 'Unsupported format' });
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database closed.');
    }
    process.exit(0);
  });
});)) {
              value = value.substring(1);
            }
            
            // Convert numeric values
            if (['onhand', 'committed', 'onorder', 'unit_price'].includes(header)) {
              value = parseFloat(value) || 0;
            }
            
            rowData[header] = value;
          }
        });

        if (!rowData.item) {
          errors.push(`Row missing item code: ${line}`);
          continue;
        }

        const allColumns = getAllColumns();
        const columns = Object.keys(rowData).filter(key => 
          allColumns[key] !== undefined
        );
        
        const columnValues = columns.map(col => rowData[col]);
        
        const query = `INSERT OR REPLACE INTO products (${columns.join(', ')}, updated_at) 
                       VALUES (${'?, '.repeat(columns.length).slice(0, -2)}, CURRENT_TIMESTAMP)`;
        
        const stmt = db.prepare(query);
        stmt.run(...columnValues);
        
        imported++;
      } catch (error) {
        errors.push(`Error importing line: ${error.message}`);
      }
    }

    res.json({
      message: 'Import completed',
      imported,
      errors: errors.length > 0 ? errors : undefined,
      newColumnsAdded
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export data
app.get('/api/export/:format', (req, res) => {
  const format = req.params.format.toLowerCase();
  
  try {
    const rows = db.prepare("SELECT * FROM products ORDER BY item").all();

    if (format === 'json') {
      res.setHeader('Content-Disposition', 'attachment; filename=products.json');
      res.setHeader('Content-Type', 'application/json');
      res.json(rows);
    } else if (format === 'csv') {
      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Products');
      
      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'csv' });
      
      res.setHeader('Content-Disposition', 'attachment; filename=products.csv');
      res.setHeader('Content-Type', 'text/csv');
      res.send(buffer);
    } else if (format === 'excel') {
      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Products');
      
      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Disposition', 'attachment; filename=products.xlsx');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(buffer);
    } else {
      res.status(400).json({ error: 'Unsupported format' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  db.close();
  process.exit(0);
});

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    const allowedTypes = /xlsx|xls|csv/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || 
                    file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                    file.mimetype === 'application/vnd.ms-excel' ||
                    file.mimetype === 'text/csv';
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only Excel and CSV files are allowed'));
    }
  }
});

// Initialize SQLite database
const db = new sqlite3.Database('./products.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    initializeDatabase();
  }
});

// Core column definitions
const coreColumns = {
  item: 'TEXT PRIMARY KEY',
  description: 'TEXT',
  grp_sect: 'TEXT',
  onhand: 'REAL',
  um: 'TEXT',
  committed: 'REAL',
  onorder: 'REAL',
  unit_price: 'REAL',
  um2: 'TEXT'
};

// Dynamic columns storage
let dynamicColumns = {};

function initializeDatabase() {
  // Create core products table
  const coreColumnsStr = Object.entries(coreColumns)
    .map(([name, type]) => `${name} ${type}`)
    .join(', ');
  
  db.run(`CREATE TABLE IF NOT EXISTS products (
    ${coreColumnsStr},
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Create table to track dynamic columns
  db.run(`CREATE TABLE IF NOT EXISTS column_definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    column_name TEXT UNIQUE,
    column_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Load existing dynamic columns
  loadDynamicColumns();
}

function loadDynamicColumns() {
  db.all("SELECT column_name, column_type FROM column_definitions", (err, rows) => {
    if (err) {
      console.error('Error loading dynamic columns:', err);
      return;
    }
    
    rows.forEach(row => {
      dynamicColumns[row.column_name] = row.column_type;
    });
    
    console.log('Loaded dynamic columns:', dynamicColumns);
  });
}

// Add new column to database
function addColumn(columnName, columnType = 'TEXT') {
  return new Promise((resolve, reject) => {
    const sanitizedName = columnName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    
    if (coreColumns[sanitizedName] || dynamicColumns[sanitizedName]) {
      resolve(false); // Column already exists
      return;
    }

    db.run(`ALTER TABLE products ADD COLUMN ${sanitizedName} ${columnType}`, (err) => {
      if (err) {
        console.error('Error adding column:', err);
        reject(err);
        return;
      }

      // Save column definition
      db.run("INSERT INTO column_definitions (column_name, column_type) VALUES (?, ?)", 
        [sanitizedName, columnType], (err) => {
        if (err) {
          console.error('Error saving column definition:', err);
          reject(err);
          return;
        }

        dynamicColumns[sanitizedName] = columnType;
        resolve(true);
      });
    });
  });
}

// Get all columns (core + dynamic)
function getAllColumns() {
  return { ...coreColumns, ...dynamicColumns };
}

// Routes

// Get all products
app.get('/api/products', (req, res) => {
  db.all("SELECT * FROM products ORDER BY item", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Get single product
app.get('/api/products/:item', (req, res) => {
  db.get("SELECT * FROM products WHERE item = ?", [req.params.item], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json(row);
  });
});

// Create or update product
app.post('/api/products', (req, res) => {
  const data = req.body;
  const allColumns = getAllColumns();
  
  // Validate required fields
  if (!data.item) {
    res.status(400).json({ error: 'Item code is required' });
    return;
  }

  // Prepare columns and values for insert/update
  const columns = Object.keys(data).filter(key => 
    allColumns[key] !== undefined || key === 'item'
  );
  
  const placeholders = columns.map(() => '?').join(', ');
  const values = columns.map(col => data[col]);
  
  const updatePlaceholders = columns
    .filter(col => col !== 'item')
    .map(col => `${col} = ?`)
    .join(', ');
  
  const updateValues = columns
    .filter(col => col !== 'item')
    .map(col => data[col]);

  // Use INSERT OR REPLACE for upsert functionality
  const query = `INSERT OR REPLACE INTO products (${columns.join(', ')}, updated_at) 
                 VALUES (${placeholders}, CURRENT_TIMESTAMP)`;
  
  db.run(query, values, function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ 
      message: this.changes > 0 ? 'Product saved successfully' : 'Product created successfully',
      item: data.item 
    });
  });
});

// Delete product
app.delete('/api/products/:item', (req, res) => {
  db.run("DELETE FROM products WHERE item = ?", [req.params.item], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (this.changes === 0) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json({ message: 'Product deleted successfully' });
  });
});

// Get column definitions
app.get('/api/columns', (req, res) => {
  res.json({
    core: coreColumns,
    dynamic: dynamicColumns,
    all: getAllColumns()
  });
});

// Add new column
app.post('/api/columns', async (req, res) => {
  const { columnName, columnType = 'TEXT' } = req.body;
  
  if (!columnName) {
    res.status(400).json({ error: 'Column name is required' });
    return;
  }

  try {
    const added = await addColumn(columnName, columnType);
    if (added) {
      res.json({ 
        message: 'Column added successfully',
        columnName: columnName.toLowerCase().replace(/[^a-z0-9_]/g, '_')
      });
    } else {
      res.status(400).json({ error: 'Column already exists' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Import from Excel/CSV file
app.post('/api/import/file', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  try {
    let data;
    const filePath = req.file.path;
    const fileExtension = path.extname(req.file.originalname).toLowerCase();

    if (fileExtension === '.csv') {
      // Handle CSV files
      const workbook = xlsx.readFile(filePath, { type: 'file' });
      const sheetName = workbook.SheetNames[0];
      data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    } else {
      // Handle Excel files
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    }

    if (!data || data.length === 0) {
      res.status(400).json({ error: 'No data found in file' });
      return;
    }

    // Analyze columns and add new ones if needed
    const sampleRow = data[0];
    const fileColumns = Object.keys(sampleRow);
    const newColumnsAdded = [];

    for (const col of fileColumns) {
      const sanitizedCol = col.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const allColumns = getAllColumns();
      
      if (!allColumns[sanitizedCol] && sanitizedCol !== 'item') {
        try {
          const added = await addColumn(col);
          if (added) {
            newColumnsAdded.push(sanitizedCol);
          }
        } catch (error) {
          console.error(`Error adding column ${col}:`, error);
        }
      }
    }

    // Import data
    let imported = 0;
    let errors = [];

    for (const row of data) {
      try {
        // Map file column names to database column names
        const mappedRow = {};
        Object.keys(row).forEach(key => {
          const sanitizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
          mappedRow[sanitizedKey] = row[key];
        });

        if (!mappedRow.item) {
          errors.push(`Row missing item code: ${JSON.stringify(row)}`);
          continue;
        }

        const allColumns = getAllColumns();
        const columns = Object.keys(mappedRow).filter(key => 
          allColumns[key] !== undefined
        );
        
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map(col => mappedRow[col]);
        
        const query = `INSERT OR REPLACE INTO products (${columns.join(', ')}, updated_at) 
                       VALUES (${placeholders}, CURRENT_TIMESTAMP)`;
        
        await new Promise((resolve, reject) => {
          db.run(query, values, function(err) {
            if (err) reject(err);
            else resolve();
          });
        });
        
        imported++;
      } catch (error) {
        errors.push(`Error importing row: ${error.message}`);
      }
    }

    // Clean up uploaded file
    require('fs').unlinkSync(filePath);

    res.json({
      message: 'Import completed',
      imported,
      errors: errors.length > 0 ? errors : undefined,
      newColumnsAdded
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Import from paste data
app.post('/api/import/paste', async (req, res) => {
  const { data, delimiter = '\t' } = req.body;
  
  if (!data) {
    res.status(400).json({ error: 'No data provided' });
    return;
  }

  try {
    const lines = data.trim().split('\n');
    if (lines.length === 0) {
      res.status(400).json({ error: 'No data lines found' });
      return;
    }

    // Parse first line to determine if it's headers or data
    const firstLine = lines[0].split(delimiter);
    const isFirstLineHeader = firstLine.some(cell => 
      isNaN(parseFloat(cell)) && !cell.match(/^\$?\d+\.?\d*$/)
    );

    let headers;
    let dataLines;

    if (isFirstLineHeader) {
      headers = firstLine.map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
      dataLines = lines.slice(1);
    } else {
      // Use default column order from your original spec
      headers = ['item', 'description', 'grp_sect', 'onhand', 'um', 'committed', 'onorder', 'unit_price', 'um2'];
      dataLines = lines;
    }

    // Add new columns if needed
    const newColumnsAdded = [];
    for (const header of headers) {
      const allColumns = getAllColumns();
      if (!allColumns[header] && header !== 'item') {
        try {
          const added = await addColumn(header);
          if (added) {
            newColumnsAdded.push(header);
          }
        } catch (error) {
          console.error(`Error adding column ${header}:`, error);
        }
      }
    }

    let imported = 0;
    let errors = [];

    for (const line of dataLines) {
      try {
        const values = line.split(delimiter).map(v => v.trim());
        if (values.length === 0 || !values[0]) continue;

        const rowData = {};
        headers.forEach((header, index) => {
          if (values[index] !== undefined) {
            let value = values[index];
            
            // Clean up currency values
            if (value.startsWith('$')) {
              value = value.substring(1);
            }
            
            // Convert numeric values
            if (['onhand', 'committed', 'onorder', 'unit_price'].includes(header)) {
              value = parseFloat(value) || 0;
            }
            
            rowData[header] = value;
          }
        });

        if (!rowData.item) {
          errors.push(`Row missing item code: ${line}`);
          continue;
        }

        const allColumns = getAllColumns();
        const columns = Object.keys(rowData).filter(key => 
          allColumns[key] !== undefined
        );
        
        const placeholders = columns.map(() => '?').join(', ');
        const columnValues = columns.map(col => rowData[col]);
        
        const query = `INSERT OR REPLACE INTO products (${columns.join(', ')}, updated_at) 
                       VALUES (${placeholders}, CURRENT_TIMESTAMP)`;
        
        await new Promise((resolve, reject) => {
          db.run(query, columnValues, function(err) {
            if (err) reject(err);
            else resolve();
          });
        });
        
        imported++;
      } catch (error) {
        errors.push(`Error importing line: ${error.message}`);
      }
    }

    res.json({
      message: 'Import completed',
      imported,
      errors: errors.length > 0 ? errors : undefined,
      newColumnsAdded
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export data
app.get('/api/export/:format', (req, res) => {
  const format = req.params.format.toLowerCase();
  
  db.all("SELECT * FROM products ORDER BY item", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    if (format === 'json') {
      res.setHeader('Content-Disposition', 'attachment; filename=products.json');
      res.setHeader('Content-Type', 'application/json');
      res.json(rows);
    } else if (format === 'csv') {
      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Products');
      
      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'csv' });
      
      res.setHeader('Content-Disposition', 'attachment; filename=products.csv');
      res.setHeader('Content-Type', 'text/csv');
      res.send(buffer);
    } else if (format === 'excel') {
      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Products');
      
      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Disposition', 'attachment; filename=products.xlsx');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(buffer);
    } else {
      res.status(400).json({ error: 'Unsupported format' });
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database closed.');
    }
    process.exit(0);
  });
});
