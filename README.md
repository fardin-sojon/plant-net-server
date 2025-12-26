# 🌱 PlantNet – A Plant Nursery Management System

## 🎯 Project Purpose
PlanNet is a comprehensive web application designed to bridge the gap between plant sellers and nature enthusiasts.  
It provides a platform where sellers can manage their nursery inventory seamlessly, and customers can explore, purchase, and bring home lush greenery with ease.  
The platform emphasizes a clean user experience, secure transactions, and efficient management tools.

---

### 
🔗 [🌐 Live Link](https://plant-net-project.netlify.app)

## 🗝 Key Features

✅ **Robust User Authentication**
- Secure Login, Signup, and Google Sign-in powered by **Firebase**.
- **Role-Based Access Control (RBAC):** Distinct dashboards and permissions for **Admins**, **Sellers**, and **Customers**.
- Secured Private Routes to protect sensitive pages.

✅ **Dashboard & Management (Private Routes)**
- **Seller Dashboard:** Add new plants with image previews, update plant details, delete inventory, and track sales.
- **Customer Dashboard:** View order history, manage cart, and track purchases.
- **Admin Dashboard:** Oversee all users and manage platform-wide settings (Manage Users).

✅ **Plant Discovery & Ordering**
- **Home Page:** Showcase of available plants with attractive cards displaying price, category, and quantity.
- **Plant Details:** In-depth view of plant information.
- **Cart & Checkout:** Seamless naming and ordering process.

✅ **Secure Payments**
- Integrated **Stripe** payment gateway for safe and reliable transactions.
- Order status updates upon successful payment.

✅ **Responsive Design & Modern UI**
- Fully responsive layout optimized for mobile, tablet, and desktop.
- Built with **Tailwind CSS** and **DaisyUI** for a modern, clean aesthetic.
- Interactive elements like Image Previews, Modals, and Toast Notifications (SweetAlert2/HotToast).

---

## � User Roles

### 👑 Admin
- **Manage Users:** View all users and update their roles (promote to Seller/Admin).
- **Platform Oversight:** Monitor system-wide activities.
- **Exclusive Access:** Dedicated admin routes for user management.

### 🏪 Seller
- **Inventory Management:** Add new plants with images, update details, and remove items.
- **Sales Tracking:** Monitor plant sales and inventory levels.
- **Business Hub:** Dedicated dashboard for managing the plant nursery.

### 🛒 Customer
- **Shopping Experience:** Browse plants, filter by category, and add to cart.
- **Secure Checkout:** Purchase plants securely using Stripe.
- **Order History:** View past orders and payment status.

---

## �📦 NPM Packages Used
| Package | Purpose |
|---------|---------|
| react | Core React library |
| react-router | Routing & Navigation |
| firebase | Authentication & Hosting |
| @tanstack/react-query | Efficient Data Fetching & Caching |
| axios | HTTP Client for API calls |
| react-hook-form | Form handling & Validation |
| stripe / react-stripe-js | Payment Processing |
| tailwindcss | Styling framework |
| daisyui | UI Component library |
| sweetalert2 / react-hot-toast | Popups & Notifications |
| react-icons | Modern Icons |

---

## 🧩 Tools & Technologies
- **Frontend:** React + Vite
- **Styling:** TailwindCSS + DaisyUI
- **Auth:** Firebase Authentication
- **Backend:** Node.js + Express.js
- **Database:** MongoDB
- **Payment:** Stripe API
- **State Management:** TanStack Query + Context API

---

## ⚙️ Run Locally
```bash
# 1. Clone the repository
git clone Server [https://github.com/fardin-sojon/plant-net-server.git]
git clone Client [https://github.com/fardin-sojon/plant-net-client.git]

# 2. Navigate to backend & install dependencies
npm install
# Configure .env (DB_USER, DB_PASS, STRIPE_SECRET, etc.)
npm run dev

# 3. Navigate to frontend & install dependencies
npm install
# Configure .env (VITE_APIKEY, VITE_API_URL, etc.)
npm run dev
```
