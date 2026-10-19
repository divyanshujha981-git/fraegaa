import React from "react";
import { Link } from "react-router-dom";
import './nav_bar.css';

export const NavBar = () => {
    return (
        <div className="navbar">
            <Link to="/" className="logo" style={{ textDecoration: 'none', color: 'white', padding: '0 20px', fontSize: '22px', fontWeight: 'bold' }}>
                Gaming Friends
            </Link>
        </div>
    );
}
