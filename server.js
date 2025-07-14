
const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

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

// Dynamic columns storage
let dynamicColumns = {};

// Initialize database files
function initializeDatabase() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2));
  }
  
  if (!fs.existsSync(COLUMNS_FILE)) {
    fs.writeFileSync(COLUMNS_FILE, JSON.stringify({}, null, 2));
  }
  
  console.log('Database initialized.');
}

// Database functions
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

function loadDynamicColumns() {
  dynamicColumns = readColumns();
  console.log('Loaded dynamic columns:', dynamicColumns);
}

function addColumn(columnName, columnType = 'TEXT') {
  const sanitizedName = columnName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  
  if (coreColumns[sanitizedName] || dynamicColumns[sanitizedName]) {
    return false;
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

function getAllColumns() {
  return { ...coreColumns, ...dynamicColumns };
}

// Initialize
initializeDatabase();
loadDynamicColumns();

// Routes
app.get('/api/products', (req, res) => {
  try {
    const products = readProducts();
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

app.post('/api/products', (req, res) => {
  const data = req.body;
  
  if (!data.item) {
    res.status(400).json({ error: 'Item code is required' });
    return;
  }

  try {
    const products = readProducts();
    const existingIndex = products.findIndex(p => p.item === data.item);
    
    const now = new Date().toISOString();
    data.updated_at = now;
    if (existingIndex === -1) {
      data.created_at = now;
    }
    
    if (existingIndex >= 0) {
      products[existingIndex] = { ...products[existingIndex], ...data };
    } else {
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

app.get('/api/columns', (req, res) => {
  res.json({
    core: coreColumns,
    dynamic: dynamicColumns,
    all: getAllColumns()
  });
});

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
      headers = ['item', 'description', 'grp_sect', 'onhand', 'um', 'committed', 'onorder', 'unit_price', 'um2'];
      dataLines = lines;
    }

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
          console.error('Error adding column ' + header + ':', error);
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
            
            if (value.startsWith('$')) {
              value = value.substring(1);
            }
            
            if (['onhand', 'committed', 'onorder', 'unit_price'].includes(header)) {
              value = parseFloat(value) || 0;
            }
            
            rowData[header] = value;
          }
        });

        if (!rowData.item) {
          errors.push('Row missing item code: ' + line);
          continue;
        }

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
        errors.push('Error importing line: ' + error.message);
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

app.post('/api/import/file', (req, res) => {
  res.status(501).json({ 
    error: 'File upload temporarily disabled. Please copy data from Excel and use paste import instead.' 
  });
});

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

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
  console.log('Database ready for connections');
});

process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  process.exit(0);
});
