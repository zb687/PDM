# PDM
Product Data Management for Ecommerce
Ecommerce Product Database
A full-stack web application for managing product inventory with dynamic vendor integration.

🚀 Quick Deploy to Railway
Download all files from the artifacts above

Create this folder structure:

ecommerce-product-db/
├── server.js
├── package.json
├── README.md
└── public/
    └── index.html
Deploy to Railway:

Go to railway.app
Click "New Project"
Choose "Deploy from GitHub repo" or upload files directly
Railway will automatically detect Node.js and deploy
Your app will be live at https://yourapp.up.railway.app
✨ Features
Dynamic Columns: Automatically adds new columns from vendor Excel sheets
Import/Export: Upload Excel/CSV files or paste tab-separated data
Persistent Database: SQLite database stores data permanently
RESTful API: Full CRUD operations for products
Responsive Design: Works on desktop and mobile
Vendor Integration: Supports multiple vendor spreadsheet formats
📋 Core Data Fields
Item Code (16 chars max)
Description (text)
Group/Section (6 chars max)
On Hand (decimal)
Unit Measure (6 chars max)
Committed (decimal)
On Order (decimal)
Unit Price (decimal)
Unit Measure 2 (6 chars max)
🔧 Local Development
Install Node.js (v14+)
Install dependencies:
npm install
Start the server:
npm start
Open browser to http://localhost:3000
📊 Import Formats
Tab-Separated Data (Copy/Paste)
CG-49779    6 120GRIT PSA DISC    1/3    1600.0000    EA    0.0000    0.0000    $0.2500    EA
CG-48529    4-1/2 X 7/8 Spindle   1/3    900.0000     EA    500.0000  0.0000    $0.6402    EA
Excel/CSV Files
Any Excel or CSV file with product data. New columns are automatically detected and added.

🌐 API Endpoints
GET /api/products - Get all products
POST /api/products - Create/update product
DELETE /api/products/:item - Delete product
POST /api/import/paste - Import pasted data
POST /api/import/file - Import Excel/CSV
GET /api/export/json - Export as JSON
GET /api/export/csv - Export as CSV
GET /api/export/excel - Export as Excel
💰 Estimated Costs
Railway: $5-10/month (usage-based)
Database: Included (SQLite file storage)
Domain: Optional ($10-15/year)
🔧 Environment Variables
Set in Railway dashboard:

NODE_ENV=production
PORT (auto-set by Railway)
📱 Mobile Support
Fully responsive design works on:

Desktop computers
Tablets
Mobile phones
🔒 Security Notes
Basic input validation
File upload restrictions (Excel/CSV only)
No authentication (simple inventory tool)
For production with sensitive data, consider adding user authentication
🆘 Support
If you encounter issues:

Check Railway deployment logs
Ensure all files are uploaded correctly
Verify the folder structure matches the requirements
Test locally first with npm start
📈 Future Enhancements
User authentication
Advanced search and filtering
Inventory alerts and notifications
Multi-location support
Advanced reporting
Barcode scanning integration
