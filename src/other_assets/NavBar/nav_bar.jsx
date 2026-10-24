import "react";
import { Link } from "react-router-dom";
import './nav_bar.css';
import logo from './logo-16-9.jpeg'

export const NavBar = () => {
    return (
        <div className="navbar">
            <Link to="/" className="logo" style={{ textDecoration: 'none', color: 'white', padding: '0 20px', fontSize: '22px', fontWeight: 'bold' }}>
                <img src={logo} alt="" style={{ height: '90%', margin: 'auto' }} />
            </Link>
        </div>
    );
}
